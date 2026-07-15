import assert from "node:assert/strict";
import test from "node:test";
import {
  QnATuiComponent,
  type QnAResponse,
} from "../extensions/herdr-answer-studio/answer-studio/qna-tui.ts";

test("left arrow moves the cursor while editing instead of changing questions", () => {
  let responses: QnAResponse[] = [];
  const tui = { requestRender() {} };
  const component = new QnATuiComponent(
    [
      { question: "First question?" },
      { question: "Second question?" },
    ],
    tui as any,
    () => {},
    {
      initialResponses: [{ customText: "ab" }],
      onResponsesChange(updated) {
        responses = updated;
      },
    },
  );

  component.handleInput("\u001b[D");
  component.handleInput("X");

  assert.equal(responses[0].customText, "aXb");
  assert.equal(responses[1].customText, "");
});

test("right arrow moves the cursor while editing instead of changing questions", () => {
  let responses: QnAResponse[] = [];
  const component = new QnATuiComponent(
    [
      { question: "First question?" },
      { question: "Second question?" },
    ],
    { requestRender() {} } as any,
    () => {},
    {
      initialResponses: [{ customText: "ab" }],
      onResponsesChange(updated) {
        responses = updated;
      },
    },
  );

  component.handleInput("\u001b[D");
  component.handleInput("\u001b[D");
  component.handleInput("\u001b[C");
  component.handleInput("X");

  assert.equal(responses[0].customText, "aXb");
  assert.equal(responses[1].customText, "");
});

test("arrow keys still change questions when no text editor is active", () => {
  const questions = [
    { question: "First question?", options: [{ label: "A", description: "" }] },
    { question: "Second question?", options: [{ label: "B", description: "" }] },
  ];

  let rightResponses: QnAResponse[] = [];
  const rightComponent = new QnATuiComponent(
    questions,
    { requestRender() {} } as any,
    () => {},
    { onResponsesChange: (updated) => (rightResponses = updated) },
  );
  rightComponent.handleInput("\u001b[C");
  rightComponent.handleInput("X");
  assert.equal(rightResponses[0].customText, "");
  assert.equal(rightResponses[1].customText, "X");

  let leftResponses: QnAResponse[] = [];
  const leftComponent = new QnATuiComponent(
    questions,
    { requestRender() {} } as any,
    () => {},
    { onResponsesChange: (updated) => (leftResponses = updated) },
  );
  leftComponent.handleInput("\t");
  leftComponent.handleInput("\u001b[D");
  leftComponent.handleInput("X");
  assert.equal(leftResponses[0].customText, "X");
  assert.equal(leftResponses[1].customText, "");
});

test("tab and shift-tab keep changing questions while editing", () => {
  let forwardResponses: QnAResponse[] = [];
  const forwardComponent = new QnATuiComponent(
    [{ question: "First question?" }, { question: "Second question?" }],
    { requestRender() {} } as any,
    () => {},
    { onResponsesChange: (updated) => (forwardResponses = updated) },
  );
  forwardComponent.handleInput("\t");
  forwardComponent.handleInput("X");
  assert.equal(forwardResponses[0].customText, "");
  assert.equal(forwardResponses[1].customText, "X");

  let backwardResponses: QnAResponse[] = [];
  const backwardComponent = new QnATuiComponent(
    [{ question: "First question?" }, { question: "Second question?" }],
    { requestRender() {} } as any,
    () => {},
    { onResponsesChange: (updated) => (backwardResponses = updated) },
  );
  backwardComponent.handleInput("\t");
  backwardComponent.handleInput("\u001b[Z");
  backwardComponent.handleInput("X");
  assert.equal(backwardResponses[0].customText, "X");
  assert.equal(backwardResponses[1].customText, "");
});
