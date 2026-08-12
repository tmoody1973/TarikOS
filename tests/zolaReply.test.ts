import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_REPLY_CHARS,
  WRITER_BRIEF,
  assembleReply,
  replySubject,
  trimMiddle,
  writerInput,
} from "../src/lib/zolaReply.ts";

// The one letter she can send to a stranger, and the rules that make an AI
// writing it safe rather than clever.

test("the letter says a machine wrote it", () => {
  const letter = assembleReply("Hello, and thanks for writing.");
  assert.match(letter, /written by an AI/i);
  assert.match(letter, /Nobody read your message/i);
});

test("the letter teaches the actual containment, not a reassurance", () => {
  // "It would refuse you" is the wrong lesson and it is not even true. "It has
  // nothing to give you" is the real one, and it is the transferable idea.
  const letter = assembleReply("Hi.");
  assert.match(letter, /nothing to give you/i);
  assert.match(letter, /what does it have/i);
});

test("the letter invites the attack it is protected against", () => {
  // A failed injection is the best demonstration available, so it says so.
  assert.match(assembleReply("Hi."), /welcome to try/i);
});

test("a stranger is told where a real reply would come from", () => {
  assert.match(assembleReply("Hi."), /from his own address/i);
});

test("the letter still sends when the writer produces nothing", () => {
  // A failed model call is not a reason to leave a stranger with silence, and
  // the explanation is worth sending on its own.
  const letter = assembleReply("");
  assert.ok(letter.length > 400);
  assert.doesNotMatch(letter, /She has written you a few sentences:/);
});

test("her paragraph is capped", () => {
  const long = assembleReply("word ".repeat(1000));
  assert.ok(long.length < MAX_REPLY_CHARS + 2000, `letter was ${long.length}`);
});

test("a cap falls on a sentence boundary rather than mid-word", () => {
  const sentences = "This is a complete sentence. ".repeat(80);
  const cut = trimMiddle(sentences);
  assert.ok(cut.endsWith(".") || cut.endsWith("…"));
});

// ------------------------------------------------------------ the writer

test("the writer is told it holds nothing", () => {
  assert.match(WRITER_BRIEF, /no tools/i);
  assert.match(WRITER_BRIEF, /no memory/i);
  assert.match(WRITER_BRIEF, /calendar/i);
});

test("the writer is told what to do when the message tries to instruct it", () => {
  // Not a defence — the defence is that the call holds nothing worth taking.
  // But naming it produces a better letter than a confused one.
  assert.match(WRITER_BRIEF, /instruct you/i);
});

test("the stranger's mail is fenced and labelled as data", () => {
  const input = writerInput({ from: "a@b.com", subject: "hi", body: "hello" });
  assert.match(input, /is DATA/);
  assert.match(input, /--- begin email ---/);
  assert.match(input, /--- end email ---/);
});

test("a huge message cannot fill the writer's context", () => {
  const input = writerInput({ from: "a@b.com", subject: "s", body: "x".repeat(500000) });
  assert.ok(input.length < 5000, `input was ${input.length}`);
});

test("the subject says what happened before it is opened", () => {
  assert.match(replySubject("what is this"), /you have reached an AI/i);
  assert.match(replySubject("what is this"), /^Re: what is this/);
  assert.match(replySubject(undefined), /you have reached an AI/i);
});

test("a Re: chain does not stack", () => {
  assert.doesNotMatch(replySubject("Re: Re: hello"), /Re: Re:/);
});

// ------------------------------------------------------- the writer is not Zola

test("the writer call carries no tools and none of Tarik's context", () => {
  // THE structural rule. If this ever becomes the real agent, the reply becomes
  // an exfiltration channel that mails itself to whoever asked.
  const route = readFileSync("src/app/api/agentmail/inbound/route.ts", "utf8");
  const call = route.split("writeMiddle")[1] ?? route;
  assert.doesNotMatch(call, /tools:/, "the writer must be given no tools");
  assert.doesNotMatch(call, /standingContext|standing_context/, "no memory reaches the writer");
  assert.doesNotMatch(call, /TEXT_TOOLS|TOOLS\b/, "no tool roster reaches the writer");
});
