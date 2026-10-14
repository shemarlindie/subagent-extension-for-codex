// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";

import type { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { setup } from "../../../app/state/controller-test-harness";
import { MOTION } from "../../../shared/components/motion/motion-utils";
import { useArrivalMotion } from "./use-arrival-motion";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type ArrivalProps = {
  taskId?: string;
};

function Arrival({ taskId }: ArrivalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useArrivalMotion(ref, taskId);

  return (
    <div ref={ref}>
      <div className="task-header" />
      <div className="evidence">
        <div className="tabs" />
      </div>
      <div className="chat-composer-box" />
    </div>
  );
}

function content(controller: Controller, taskId?: string) {
  return (
    <ControllerContext value={controller}>
      <Arrival taskId={taskId} />
    </ControllerContext>
  );
}

function mockLayout(reduced = false) {
  const animate = vi.fn();

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
    restore() {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "animate", original);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "animate");
      }
    },
  };
}

test("arrival settles each element at its fractional layout height only once", (t) => {
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

  for (const [index, height] of [64.3984375, 38.5, 92.25].entries()) {
    expect(motion.animate).toHaveBeenNthCalledWith(
      index + 1,
      [
        index === 2
          ? { height: "168.5px", overflow: "hidden" }
          : { height: "0px", opacity: 0, overflow: "hidden" },
        index === 2
          ? { height: `${height}px`, overflow: "hidden" }
          : { height: `${height}px`, opacity: 1, overflow: "hidden" },
      ],
      { duration: MOTION.slow, easing: MOTION.easing },
    );
  }

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
