// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { useNewTaskMotion } from "./use-new-task-motion";

const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate",
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  }
});

type ViewProps = { composing: boolean; taskId?: string };

function View({ composing, taskId = "one" }: ViewProps) {
  const detail = useRef<HTMLElement>(null);
  const taskViewRef = useNewTaskMotion(detail, composing, taskId);

  return (
    <section ref={detail}>
      {composing ? (
        <div className="new-task-view">
          <div className="evidence" />
          <div className="chat-composer-box new-task-box" />
        </div>
      ) : (
        <div key={taskId} ref={taskViewRef}>
          <div className="task-header">
            <button id="title">Task title</button>
          </div>
          <div className="evidence">
            <div className="tabs" id="tabs">
              Chat
            </div>
          </div>
          <div className="chat-composer-box" />
        </div>
      )}
    </section>
  );
}

function motion(reduced = false) {
  const animations: {
    cancel: ReturnType<typeof vi.fn>;
    onfinish?: () => void;
  }[] = [];

  const animate = vi.fn(
    (_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
      const animation = { cancel: vi.fn() };
      animations.push(animation);

      return animation;
    },
  );

  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const height = this.classList.contains("new-task-box") ? 168.5 : 64.25;

      return new DOMRect(0, 0, 400, height);
    },
  );

  return { animate, animations };
}

test("opening new task reverses header, tabs and composer motion and removes visual copies", () => {
  const { animate, animations } = motion();
  const view = render(<View composing={false} />);
  view.rerender(<View composing />);
  expect(animate).toHaveBeenCalledTimes(3);

  const copies =
    view.container.querySelectorAll<HTMLElement>("[aria-hidden=true]");

  expect(copies).toHaveLength(2);

  for (const copy of copies) {
    expect(copy.inert).toBe(true);
    expect(copy.querySelector("[id]")).toBeNull();
    expect(copy.id).toBe("");
  }

  view.rerender(<View composing />);
  expect(animate).toHaveBeenCalledTimes(3);
  animations.forEach((animation) => animation.onfinish?.());
  expect(view.container.querySelector("[aria-hidden=true]")).toBeNull();
});

test("leaving new task cancels motion and removes copies before another task opens", () => {
  const { animations } = motion();
  const view = render(<View composing={false} />);
  view.rerender(<View composing />);
  view.rerender(<View composing={false} taskId="two" />);
  expect(view.container.querySelector("[aria-hidden=true]")).toBeNull();

  animations.forEach((animation) =>
    expect(animation.cancel).toHaveBeenCalledOnce(),
  );
});

test("reduced motion and initial composer render skip the transition", () => {
  const { animate } = motion(true);
  const view = render(<View composing />);
  view.rerender(<View composing={false} />);
  view.rerender(<View composing />);
  expect(animate).not.toHaveBeenCalled();
  expect(view.container.querySelector("[aria-hidden=true]")).toBeNull();
});

test("an initial draft does not animate when animation support is available", () => {
  const { animate } = motion();
  render(<View composing />);
  expect(animate).not.toHaveBeenCalled();
});
