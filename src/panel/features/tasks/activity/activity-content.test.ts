// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { Controller } from "../../../app/state/controller";
import { ControllerContext } from "../../../app/state/controller-context";
import { ActivityContent, ActivityValue } from "./activity-content";
import {
  assertAbsent,
  event,
  markup,
  parseHtml,
} from "./activity-ui-test-harness";
import { EventList as GroupedEventList } from "./event-list";

test("raw-only activity data stays behind its collapsed inspector", () => {
  const raw = {
    type: "system",
    subtype: "init",
    extra_details: {
      item_count: 0,
      enabled: false,
      description: "Readable detail",
    },
    uuid: "raw-only-id",
  };

  const doc = markup([event("claude.activity", { ...raw, raw_response: raw })]);

  const disclosure = doc.querySelector("details.activity-raw");

  assert.equal(disclosure?.hasAttribute("open"), false);
  assertAbsent(disclosure?.querySelector(".json-tree") ?? null);
  assert.ok(!doc.body.textContent?.includes("raw-only-id"));
});

test("mixed content, tool inputs and tool results are readable and HTML stays literal", () => {
  const malicious = "<script>window.injected = true</script>";

  const doc = markup([
    event("agent.message", { text: malicious }, "message"),
    event(
      "agent.content",
      {
        role: "assistant",
        content: {
          type: "thinking",
          thinking: "Reasoning detail",
          signature: "hidden-signature",
        },
      },
      "thinking",
    ),
    event(
      "agent.content",
      {
        content: {
          type: "document",
          source: { type: "text", data: "Attached document text" },
        },
      },
      "document",
    ),
    event(
      "agent.content",
      { content: { type: "future_block", item_count: 0, enabled: false } },
      "future",
    ),
    event(
      "tool.started",
      {
        id: "tool",
        name: "Read",
        input: { file_path: "src/a.ts", offset: 0, enabled: false },
      },
      "started",
    ),
    event(
      "tool.completed",
      {
        id: "tool",
        error: false,
        content: [
          { type: "text", text: "Tool output" },
          { type: "text", text: malicious },
        ],
      },
      "completed",
    ),
  ]);

  const text = doc.body.textContent ?? "";

  for (const snippet of [
    malicious,
    "Thinking",
    "Reasoning detail",
    "Attached document text",
    "Future block",
    "File path",
    "src/a.ts",
    "Offset0",
    "EnabledNo",
    "Tool output",
    "Read started",
    "Read completed",
  ]) {
    assert.ok(text.includes(snippet), snippet);
  }

  assert.ok(!text.includes("hidden-signature"));
  assertAbsent(doc.querySelector("script"));
});

test("failures are distinguished for results, tool errors and denied permissions", () => {
  const doc = markup([
    event(
      "tool.completed",
      { id: "tool", error: true, content: "Read denied" },
      "tool",
    ),
    event(
      "agent.completed",
      {
        subtype: "error_max_turns",
        is_error: true,
        cost_usd: 0,
        errors: ["Turn limit"],
      },
      "result",
    ),
    event(
      "claude.activity",
      {
        type: "system",
        subtype: "permission_denied",
        message: "Permission blocked",
      },
      "permission",
    ),
  ]);

  assert.equal(doc.querySelectorAll(".activity-error").length, 3);

  for (const snippet of [
    "Tool failed",
    "Agent failed",
    "Permission denied",
    "Turn limit",
    "Cost$0.00",
  ]) {
    assert.ok(doc.body.textContent?.includes(snippet), snippet);
  }
});

test("supported base64 images render inline, including images nested in documents and tool results", () => {
  const image = (media_type: string) => ({
    type: "image",
    source: { type: "base64", media_type, data: "aGVsbG8=" },
  });

  const doc = markup([
    event(
      "agent.content",
      {
        content: [
          image("image/png"),
          image("image/jpeg"),
          image("image/gif"),
          image("image/webp"),
        ],
      },
      "images",
    ),
    event(
      "tool.completed",
      {
        id: "tool",
        content: [{ type: "tool_result", content: [image("image/png")] }],
      },
      "nested-tool",
    ),
    event(
      "agent.content",
      {
        content: {
          type: "document",
          title: "Nested document",
          source: {
            type: "content",
            content: [
              image("image/png"),
              { type: "text", text: "Nested caption" },
            ],
          },
        },
      },
      "nested-document",
    ),
  ]);

  const images = Array.from(doc.querySelectorAll("img.activity-image"));
  assert.equal(images.length, 6);

  for (const image of images) {
    assert.match(
      image.getAttribute("src") ?? "",
      /^data:image\/(png|jpeg|gif|webp);base64,aGVsbG8=$/,
    );

    assert.equal(image.getAttribute("alt"), "Claude activity attachment");
  }

  assert.match(doc.body.textContent ?? "", /Nested document/);
  assert.match(doc.body.textContent ?? "", /Nested caption/);
});

test("unsupported image sources present readable metadata without embedding unsafe media", () => {
  const doc = markup([
    event(
      "agent.content",
      {
        content: {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/svg+xml",
            data: "private-encoded-svg",
          },
        },
      },
      "svg",
    ),
    event(
      "agent.content",
      {
        content: {
          type: "image",
          source: { type: "url", url: "https://example.invalid/image.png" },
        },
      },
      "remote",
    ),
    event(
      "agent.content",
      {
        content: {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "private-encoded-pdf",
          },
        },
      },
      "pdf",
    ),
  ]);

  assert.equal(doc.querySelectorAll("img").length, 0);
  const text = doc.body.textContent ?? "";

  for (const snippet of [
    "Image",
    "Document",
    "Source",
    "Media type",
    "image/svg+xml",
    "application/pdf",
    "https://example.invalid/image.png",
  ]) {
    assert.ok(text.includes(snippet), snippet);
  }

  assert.ok(!text.includes("private-encoded-svg"));
  assert.ok(!text.includes("private-encoded-pdf"));
  assert.equal(doc.querySelectorAll("details.activity-raw").length, 3);
});

const nestedContentNotice = "Nested content omitted · inspect raw response";

function wrapNested(
  value: unknown,
  wrap: (value: unknown) => unknown,
  levels: number,
): unknown {
  for (let i = 0; i < levels; i++) value = wrap(value);

  return value;
}

function contentMarkup(content: unknown) {
  return parseHtml(
    renderToStaticMarkup(
      // Code blocks hold a copy action, which reports through the controller.
      createElement(
        ControllerContext.Provider,
        { value: {} as Controller },
        createElement(ActivityContent, { content }),
      ),
    ),
  );
}

for (const [name, wrap] of [
  [
    "tool results",
    (value: unknown) => ({ type: "tool_result", content: value }),
  ],
  [
    "documents",
    (value: unknown) => ({
      type: "document",
      source: { type: "content", content: value },
    }),
  ],
] as const) {
  test(`deeply nested ${name} render a bounded fallback`, () => {
    const content = wrapNested(
      { type: "text", text: "Hidden deep text" },
      wrap,
      10000,
    );

    const doc = contentMarkup(content);
    assert.equal(doc.querySelector(".muted")?.textContent, nestedContentNotice);
    assert.ok(!doc.body.textContent?.includes("Hidden deep text"));
    assertAbsent(doc.querySelector("pre"));
  });
}

test("content remains readable through the nesting limit and is omitted beyond it", () => {
  const text = { type: "text", text: "Visible at boundary" };
  const withinLimit = contentMarkup(wrapNested(text, (value) => [value], 6));
  assert.equal(withinLimit.body.textContent, "Visible at boundary");
  const beyondLimit = contentMarkup(wrapNested(text, (value) => [value], 7));
  assert.equal(beyondLimit.body.textContent, nestedContentNotice);
});

test("metadata and content share a nesting budget without serializing omitted payloads", () => {
  const payload = {
    secret: "Hidden metadata",
    toJSON() {
      throw new Error("Omitted payload must not be serialized");
    },
  };

  const tool = { type: "tool_use", name: "Read", input: payload };
  const doc = contentMarkup(wrapNested(tool, (value) => [value], 6));
  assert.ok(doc.body.textContent?.includes(nestedContentNotice));
  assert.ok(!doc.body.textContent?.includes("Hidden metadata"));
  const metadata = wrapNested(payload, (value) => ({ nested: value }), 10000);

  const html = renderToStaticMarkup(
    createElement(ActivityValue, { value: metadata }),
  );

  assert.ok(html.includes(nestedContentNotice));
  assert.ok(!html.includes("Hidden metadata"));
  assert.ok(!html.includes("<pre>"));
});

test("cyclic content and metadata stop at the nesting limit", () => {
  const tool: Record<string, unknown> = { type: "tool_result" };
  tool.content = tool;

  assert.ok(
    contentMarkup(tool).body.textContent?.includes(nestedContentNotice),
  );

  const metadata: Record<string, unknown> = {};
  metadata.self = metadata;

  const html = renderToStaticMarkup(
    createElement(ActivityValue, { value: metadata }),
  );

  assert.ok(html.includes(nestedContentNotice));
});

test("error fields and assistant errors preserve exact diagnostic text", () => {
  const diagnostic = "failed_to_read /tmp/my_file.test.ts: ENOENT.code";
  const content = contentMarkup({ error: diagnostic });
  assert.equal(content.querySelector("dd")?.textContent, diagnostic);

  const doc = markup([
    event(
      "claude.activity",
      {
        type: "assistant",
        error: diagnostic,
        message: { content: [] },
      },
      "diagnostic-assistant",
    ),
  ]);

  assert.equal(doc.querySelector("p.error")?.textContent, diagnostic);
});

test("stream blocks ignore invalid indexes while default and numeric indexes accumulate independently", () => {
  const frames: Record<string, unknown>[] = [
    { type: "message_start", message: { id: "validated-stream-indexes" } },
    {
      type: "content_block_start",
      content_block: { type: "text", text: "Default " },
    },
    {
      type: "content_block_delta",
      index: null,
      delta: { type: "text_delta", text: "block" },
    },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "Second " },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "block" },
    },
  ];

  for (const index of [
    {},
    "0",
    -1,
    0.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    frames.push(
      {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "Invalid start" },
      },
      {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: "Invalid delta" },
      },
    );
  }

  frames.push({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: " remains" },
  });

  const events = frames.map((frame, i) =>
    event(
      "claude.activity",
      {
        type: "stream_event",
        event: frame,
      },
      `validated-stream-index-${i}`,
    ),
  );

  const doc = parseHtml(
    renderToStaticMarkup(createElement(GroupedEventList, { events })),
  );

  const blocks = Array.from(
    doc.querySelectorAll(".activity-stream > .activity-body .markdown-body p"),
    (node) => node.textContent,
  );

  assert.deepEqual(blocks, ["Default block remains", "Second block"]);
});

test("fenced code in message text renders as a code block", () => {
  const doc = contentMarkup([
    { type: "text", text: "Run this:\n```sh\nnpm test\n```\nThen retry." },
  ]);

  assert.equal(doc.querySelector("pre.activity-code")?.textContent, "npm test");
  assert.equal(doc.querySelector(".code-block-language")?.textContent, "sh");
  assert.ok(doc.querySelector(".code-block button[aria-label='Copy code']"));

  assert.deepEqual(
    [...doc.querySelectorAll("p.activity-text")].map((p) => p.textContent),
    ["Run this:", "Then retry."],
  );
});

test("unclosed fences while streaming stay plain text", () => {
  const doc = contentMarkup("Partial ```sh\nnpm te");
  assertAbsent(doc.querySelector("pre"));
  assert.equal(doc.querySelector("p")?.textContent, "Partial ```sh\nnpm te");
});

test("thinking-only assistant groups keep their own debug identity", () => {
  const thinking = event(
    "agent.content",
    { role: "assistant", content: { type: "thinking", thinking: "Hmm" } },
    "thinking-only",
  );

  const reply = event(
    "agent.content",
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Hmm" },
        { type: "text", text: "Done" },
      ],
    },
    "thinking-plus-reply",
  );

  const view = render(
    createElement(GroupedEventList, { events: [thinking, reply] }),
  );

  const groups = view.container.querySelectorAll(".activity-group");
  assert.equal(groups.length, 2);

  const thinkingGroup = view
    .getByRole("button", { name: "Debug activity: Thinking" })
    .closest(".activity-group");

  assert.ok(thinkingGroup);
  // The thinking text is only available through the debug view.
  assertAbsent(thinkingGroup.querySelector("details"));
  assert.equal(view.getAllByText("Assistant").length, 1);
  cleanup();
});

test("an assistant response bubble contains only its thinking note", () => {
  const raw = {
    type: "assistant",
    message: {
      id: "thinking-bubble",
      content: [
        { type: "text", text: "Response text" },
        { type: "thinking", thinking: "Reasoning note" },
        { type: "text", text: "More response text" },
      ],
    },
  };

  const events = [
    event(
      "agent.message",
      {
        role: "assistant",
        text: "Response text",
        content: { type: "text", text: "Response text" },
        raw_response: raw,
      },
      "thinking-bubble-message",
    ),
    event(
      "agent.content",
      {
        role: "assistant",
        content: { type: "thinking", thinking: "Reasoning note" },
        raw_response: raw,
      },
      "thinking-bubble-thinking",
    ),
    event(
      "agent.content",
      {
        role: "assistant",
        content: { type: "text", text: "More response text" },
        raw_response: raw,
      },
      "thinking-bubble-extra-text",
    ),
  ];

  const view = render(createElement(GroupedEventList, { events }));
  const group = view.container.querySelector(".activity-message")!;
  const bubble = group.querySelector(".activity-body")!;

  assert.equal(
    group.querySelector(".activity-group-secondary")?.textContent,
    "Started a response...",
  );

  assert.equal(
    bubble.querySelector("details.activity-thinking summary")?.textContent,
    "Thinking",
  );

  assert.deepEqual(
    [...bubble.querySelectorAll(".activity-text")].map(
      (node) => node.textContent,
    ),
    ["Reasoning note"],
  );

  assert.ok(!bubble.textContent?.includes("Response text"));
  assert.ok(!bubble.textContent?.includes("More response text"));

  cleanup();
});

const markdownText = "**bold**\n\n- one\n- two";

const messageBody = (type: "assistant" | "user") =>
  markup([
    event(
      "claude.activity",
      {
        type,
        message: {
          role: type,
          content: [{ type: "text", text: markdownText }],
        },
      },
      `body-${type}`,
    ),
  ]);

const workerContent = (content: unknown) =>
  parseHtml(
    renderToStaticMarkup(
      createElement(ActivityContent, { content, markdown: true }),
    ),
  );

test.each([
  {
    name: "tool output",
    render: () =>
      workerContent([{ type: "tool_result", content: markdownText }]),
    markdown: false,
  },
  {
    name: "content without the Markdown option",
    render: () => contentMarkup({ type: "text", text: markdownText }),
    markdown: false,
  },
  {
    name: "an assistant message body",
    render: () => messageBody("assistant"),
    markdown: true,
  },
  {
    name: "a user message body",
    render: () => messageBody("user"),
    markdown: false,
  },
])("$name renders Markdown: $markdown", ({ render, markdown }) => {
  const doc = render();

  if (markdown) {
    expect(doc.querySelector(".activity-markdown strong")?.textContent).toBe(
      "bold",
    );

    expect(doc.querySelectorAll(".activity-markdown li")).toHaveLength(2);
  } else {
    expect(doc.querySelector(".activity-markdown")).toBeNull();
    expect(doc.querySelector(".activity-text")?.textContent).toBe(markdownText);
  }
});
