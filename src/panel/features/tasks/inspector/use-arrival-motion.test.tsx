// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";

import type { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { setup } from "../../../app/state/controller-test-harness";
import { useArrivalMotion } from "./use-arrival-motion";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type ArrivalProps = {
  taskId?: string;
  composing?: boolean;
};

function Arrival({ taskId, composing = false }: ArrivalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const draftRef = useArrivalMotion(ref, taskId, composing);

  if (composing) {
    return (
      <div ref={draftRef} key="draft">
        <div className="chat-composer-box new-task-box" />
      </div>
    );
  }

  return (
    <div ref={ref}>
      <div className="task-header" />
      <div className="evidence">
        <div className="tabs" style={{ marginTop: 20 }} />
      </div>
      <div className="chat-composer-box" />
    </div>
  );
}

function content(controller: Controller, taskId?: string, composing = false) {
  return (
    <ControllerContext value={controller}>
      <Arrival taskId={taskId} composing={composing} />
    </ControllerContext>
  );
}

function mockLayout(reduced = false) {
  const animations: { cancel: ReturnType<typeof vi.fn> }[] = [];

  const animate = vi.fn(() => {
    const animation = { cancel: vi.fn() };
    animations.push(animation);

    return animation;
  });

  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });

  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const heights: Record<string, number> = {
        "task-header": 64.3984375,
        tabs: 38.5,
        "chat-composer-box": 92.25,
        "chat-composer-box new-task-box": 168.5,
      };

      return new DOMRect(0, 0, 400, heights[this.className] ?? 0);
    },
  );

  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return Math.round(this.getBoundingClientRect().height);
    },
  );

  return {
    animate,
    animations,
    restore() {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "animate", original);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "animate");
      }
    },
  };
}

test("arrival state is consumed once and does not replay after remount", (t) => {
  const { controller } = setup();
  const motion = mockLayout();

  t.onTestFinished(() => {
    motion.restore();
    controller.dispose();
  });

  controller.session.update("task", "task-1", { composerArrival: 168.5 });
  const view = render(content(controller));
  expect(motion.animate).not.toHaveBeenCalled();

  view.rerender(content(controller, "task-1"));
  expect(motion.animate).toHaveBeenCalledTimes(3);

  expect(
    controller.session.get("task", "task-1").composerArrival,
  ).toBeUndefined();

  view.unmount();
  render(content(controller, "task-1"));
  expect(motion.animate).toHaveBeenCalledTimes(3);
});

test("reduced motion consumes arrival without animating", (t) => {
  const { controller } = setup();
  const motion = mockLayout(true);

  t.onTestFinished(() => {
    motion.restore();
    controller.dispose();
  });

  controller.session.update("task", "task-1", { composerArrival: 168.5 });
  render(content(controller, "task-1"));
  expect(motion.animate).not.toHaveBeenCalled();

  expect(
    controller.session.get("task", "task-1").composerArrival,
  ).toBeUndefined();
});

test("selecting from the draft animates only the first selected task", (t) => {
  const { controller } = setup();
  const motion = mockLayout();

  t.onTestFinished(() => {
    motion.restore();
    controller.dispose();
  });

  const view = render(content(controller, undefined, true));
  view.rerender(content(controller, "existing-task"));
  expect(motion.animate).toHaveBeenCalledTimes(3);

  expect(
    controller.session.get("task", "existing-task").composerArrival,
  ).toBeUndefined();

  view.rerender(content(controller, "another-task"));
  expect(motion.animate).toHaveBeenCalledTimes(3);
});

test("leaving the draft without selecting a task does not animate a later selection", (t) => {
  const { controller } = setup();
  const motion = mockLayout();

  t.onTestFinished(() => {
    motion.restore();
    controller.dispose();
  });

  const view = render(content(controller, undefined, true));
  view.rerender(content(controller));
  view.rerender(content(controller, "existing-task"));
  expect(motion.animate).not.toHaveBeenCalled();
});

test("selecting from the draft respects reduced motion", (t) => {
  const { controller } = setup();
  const motion = mockLayout(true);

  t.onTestFinished(() => {
    motion.restore();
    controller.dispose();
  });

  const view = render(content(controller, undefined, true));
  view.rerender(content(controller, "existing-task"));
  expect(motion.animate).not.toHaveBeenCalled();
});

test("leaving an arriving task cancels each animation before another view opens", (t) => {
  const { controller } = setup();
  const motion = mockLayout();

  t.onTestFinished(() => {
    motion.restore();
    controller.dispose();
  });

  const view = render(content(controller, undefined, true));
  view.rerender(content(controller, "existing-task"));
  expect(motion.animations).toHaveLength(3);
  view.rerender(content(controller, undefined, true));

  for (const animation of motion.animations) {
    expect(animation.cancel).toHaveBeenCalledOnce();
  }
});
