// Records which components each React commit renders, and which of those
// renders were wasted: the component's output came out the same as before.
// React DOM reads the DevTools hook once, when it loads, so test files import
// this module before anything that imports React DOM.

/** The fiber fields the recorder reads. React may change them in an upgrade. */
type Fiber = {
  tag: number;
  key: string | null;
  type: unknown;
  memoizedProps: unknown;
  flags: number;
  alternate: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
};

type Output = { type: unknown; key: string | null; props: unknown }[];

/** Why a wasted render happened, judged from the component's props. */
export type Cause =
  | "own state, context or store selection"
  | "parent rendered with the same props"
  | "new functions only"
  | "new props equal by value"
  | "changed props it doesn't show";

export type Render = {
  name: string;
  /** Whether the component is declared in `src/panel`, when that's known. */
  ours: boolean;
  /** Its component ancestors, outermost first. */
  path: string[];
  commit: number;
  mount: boolean;
  wasted: boolean;
  cause?: Cause;
};

export type Finding = { name: string; ours: boolean; path: string[] };

export type RenderResult = {
  commits: number;
  renders: Render[];
  /** Components unmounted and mounted again with equal props in one commit. */
  remounts: Finding[];
  /** Components that rendered but ended with the output they started with. */
  transients: Finding[];
};

const FUNCTION = 0;
const CLASS = 1;
const FORWARD_REF = 11;
const SIMPLE_MEMO = 15;
const PERFORMED_WORK = 1;

// A `memo` with a comparison function makes a fiber of its own, whose child
// is the inner component. Only the inner one counts, so a render counts once.
const COMPONENT_TAGS = new Set([FUNCTION, CLASS, FORWARD_REF, SIMPLE_MEMO]);

const MEMO_TYPE = Symbol.for("react.memo");

const ELEMENT_TYPES = new Set([
  Symbol.for("react.transitional.element"),
  Symbol.for("react.element"),
]);

/** Our components' types, filled by the report's transform. */
const registry = new Set<unknown>();

/**
 * Registers a component declared in `src/panel`. Names come from the
 * component's function, so they match with or without the registry.
 */
export function registerComponent(component: unknown) {
  registry.add(
    isObject(component) && component.$$typeof === MEMO_TYPE
      ? component.type
      : component,
  );
}

/** Names of the registered components no recording reached. */
export function unreachedComponents() {
  return [...registry]
    .filter((type) => !reached.has(type))
    .map(typeName)
    .sort();
}

/** Component types any recording saw render or mount. */
const reached = new Set<unknown>();

let injected = false;
let commitCount = 0;
let active: Recorder | undefined;

Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
  configurable: true,
  value: {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject() {
      injected = true;

      return 1;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount(_renderer: number, fiber: Fiber) {
      active?.unmounted(fiber);
    },
    onCommitFiberRoot(_renderer: number, root: { current: Fiber }) {
      commitCount++;
      active?.commit(root.current);
    },
  },
});

/** Commits since the recorder loaded, recording or not. */
export const commits = () => commitCount;

/** Starts recording commits until `stop`. */
export function recordRenders() {
  if (!injected) {
    throw new Error(
      "React DOM loaded before the render recorder. Import the recorder first.",
    );
  }

  if (active) throw new Error("A recording is already running");

  const recorder = new Recorder();
  active = recorder;

  return {
    stop(): RenderResult {
      active = undefined;

      return recorder.result();
    },
  };
}

type Instance = {
  name: string;
  ours: boolean;
  path: string[];
  before: Output;
  after: Output;
  changed: boolean;
  unmounted: boolean;
};

class Recorder {
  private commitIndex = 0;
  private renders: Render[] = [];
  private remounts: Finding[] = [];
  /** Unmounts in the current commit, with the fields React clears later. */
  private unmounts: { fiber: Fiber; parent: Fiber | null; props: unknown }[] =
    [];

  private instances = new Map<Fiber, Instance>();

  unmounted(fiber: Fiber) {
    if (!COMPONENT_TAGS.has(fiber.tag)) return;

    this.unmounts.push({
      fiber,
      parent: fiber.return,
      props: fiber.memoizedProps,
    });

    const instance = this.instanceOf(fiber);
    if (instance) instance.unmounted = true;
  }

  commit(root: Fiber) {
    const index = ++this.commitIndex;
    const mounts: Fiber[] = [];

    walk(root.child, (fiber) => {
      const previous = fiber.alternate;
      const name = typeName(fiber.type);
      const ours = registry.has(fiber.type);
      reached.add(fiber.type);

      if (!previous) {
        mounts.push(fiber);

        this.renders.push({
          name,
          ours,
          path: pathOf(fiber),
          commit: index,
          mount: true,
          wasted: false,
        });

        return;
      }

      const before = outputOf(previous);
      const after = outputOf(fiber);
      const wasted = sameOutput(before, after);
      const path = pathOf(fiber);

      this.renders.push({
        name,
        ours,
        path,
        commit: index,
        mount: false,
        wasted,
        ...(wasted ? { cause: causeOf(fiber, previous) } : {}),
      });

      const instance = this.instanceOf(fiber);

      if (instance) {
        instance.after = after;
        instance.changed ||= !wasted;
        this.instances.delete(previous);
        this.instances.set(fiber, instance);
      } else {
        this.instances.set(fiber, {
          name,
          ours,
          path,
          before,
          after,
          changed: !wasted,
          unmounted: false,
        });
      }
    });

    this.findRemounts(mounts);
    this.unmounts = [];
  }

  result(): RenderResult {
    const transients = [...this.instances.values()]
      .filter(
        (instance) =>
          instance.changed &&
          !instance.unmounted &&
          sameOutput(instance.before, instance.after),
      )
      .map(({ name, ours, path }) => ({ name, ours, path }));

    return {
      commits: this.commitIndex,
      renders: this.renders,
      remounts: this.remounts,
      transients,
    };
  }

  private instanceOf(fiber: Fiber) {
    return (
      this.instances.get(fiber) ??
      (fiber.alternate ? this.instances.get(fiber.alternate) : undefined)
    );
  }

  /** Mounts that replace an unmounted component of the same type and props. */
  private findRemounts(mounts: Fiber[]) {
    const unmounted = new Set(this.unmounts.map(({ fiber }) => fiber));

    for (const fiber of mounts) {
      const parent = fiber.return;

      const replaced = this.unmounts.find(
        (old) =>
          old.fiber.type === fiber.type &&
          old.parent !== null &&
          !unmounted.has(old.parent) &&
          (old.parent === parent || old.parent === parent?.alternate) &&
          equal(old.props, fiber.memoizedProps),
      );

      if (replaced) {
        this.remounts.push({
          name: typeName(fiber.type),
          ours: registry.has(fiber.type),
          path: pathOf(fiber),
        });
      }
    }
  }
}

/** Visits every component that rendered or mounted in the commit. */
function walk(first: Fiber | null, visit: (fiber: Fiber) => void) {
  for (let fiber = first; fiber; fiber = fiber.sibling) {
    const previous = fiber.alternate;

    if (
      COMPONENT_TAGS.has(fiber.tag) &&
      (!previous || fiber.flags & PERFORMED_WORK)
    ) {
      visit(fiber);
    }

    // A subtree React skipped keeps its children.
    if (!previous || fiber.child !== previous.child) walk(fiber.child, visit);
  }
}

/** A component's name, from its function as React names it. */
export function typeName(type: unknown) {
  if (typeof type === "function") {
    return (
      (type as { displayName?: string }).displayName || type.name || "Anonymous"
    );
  }

  if (isObject(type)) {
    const { displayName, render } = type as {
      displayName?: string;
      render?: { name?: string };
    };

    return displayName || render?.name || "Anonymous";
  }

  return "Anonymous";
}

/** Component ancestors, outermost first: ours once any are registered. */
function pathOf(fiber: Fiber) {
  const names: string[] = [];

  for (let parent = fiber.return; parent; parent = parent.return) {
    if (
      COMPONENT_TAGS.has(parent.tag) &&
      (registry.size === 0 || registry.has(parent.type))
    ) {
      names.push(typeName(parent.type));
    }
  }

  return names.reverse();
}

function outputOf(fiber: Fiber): Output {
  const output: Output = [];

  for (let child = fiber.child; child; child = child.sibling) {
    output.push({
      type: child.type,
      key: child.key,
      props: child.memoizedProps,
    });
  }

  return output;
}

function sameOutput(a: Output, b: Output) {
  return (
    a.length === b.length &&
    a.every((child, index) => {
      const other = b[index];

      return (
        other !== undefined &&
        child.type === other.type &&
        child.key === other.key &&
        equal(child.props, other.props)
      );
    })
  );
}

function causeOf(fiber: Fiber, previous: Fiber): Cause {
  const props = fiber.memoizedProps;
  const before = previous.memoizedProps;
  if (props === before) return "own state, context or store selection";
  if (!isObject(props) || !isObject(before)) return "new props equal by value";

  const changed = Object.keys(props).filter(
    (key) => !Object.is(props[key], before[key]),
  );

  if (changed.length === 0) return "parent rendered with the same props";

  if (changed.every((key) => typeof props[key] === "function")) {
    return "new functions only";
  }

  return changed.every((key) => equal(props[key], before[key]))
    ? "new props equal by value"
    : "changed props it doesn't show";
}

/**
 * The rule's equality: functions are equal, plain objects and arrays compare
 * deeply, elements compare by type, key and props, and anything else by
 * identity.
 */
export function equal(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === "function" && typeof b === "function") return true;
  if (!isObject(a) || !isObject(b) || depth > 100) return false;

  if (isElement(a) || isElement(b)) {
    return (
      isElement(a) &&
      isElement(b) &&
      a.type === b.type &&
      a.key === b.key &&
      equal(a.props, b.props, depth + 1)
    );
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => equal(item, b[index], depth + 1))
    );
  }

  if (!isPlain(a) || !isPlain(b)) return false;
  const keys = Object.keys(a);

  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) => Object.hasOwn(b, key) && equal(a[key], b[key], depth + 1),
    )
  );
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isElement(value: Record<PropertyKey, unknown>) {
  return ELEMENT_TYPES.has(value.$$typeof as symbol);
}

function isPlain(value: object) {
  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}
