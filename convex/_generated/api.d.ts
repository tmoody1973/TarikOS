/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as browserSessions from "../browserSessions.js";
import type * as contacts from "../contacts.js";
import type * as contactsCron from "../contactsCron.js";
import type * as contactsLib from "../contactsLib.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as documents from "../documents.js";
import type * as documentsLib from "../documentsLib.js";
import type * as embeddingsLib from "../embeddingsLib.js";
import type * as feeds from "../feeds.js";
import type * as habits from "../habits.js";
import type * as habitsCron from "../habitsCron.js";
import type * as habitsLib from "../habitsLib.js";
import type * as journal from "../journal.js";
import type * as memoryOps from "../memoryOps.js";
import type * as secondBrain from "../secondBrain.js";
import type * as settingsLib from "../settingsLib.js";
import type * as studio from "../studio.js";
import type * as studioLib from "../studioLib.js";
import type * as studioSources from "../studioSources.js";
import type * as telegram from "../telegram.js";
import type * as telegramLib from "../telegramLib.js";
import type * as telos from "../telos.js";
import type * as telosLib from "../telosLib.js";
import type * as transcripts from "../transcripts.js";
import type * as workflowLib from "../workflowLib.js";
import type * as workflowRunner from "../workflowRunner.js";
import type * as workflows from "../workflows.js";
import type * as zolaDrafts from "../zolaDrafts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  browserSessions: typeof browserSessions;
  contacts: typeof contacts;
  contactsCron: typeof contactsCron;
  contactsLib: typeof contactsLib;
  crons: typeof crons;
  dashboard: typeof dashboard;
  documents: typeof documents;
  documentsLib: typeof documentsLib;
  embeddingsLib: typeof embeddingsLib;
  feeds: typeof feeds;
  habits: typeof habits;
  habitsCron: typeof habitsCron;
  habitsLib: typeof habitsLib;
  journal: typeof journal;
  memoryOps: typeof memoryOps;
  secondBrain: typeof secondBrain;
  settingsLib: typeof settingsLib;
  studio: typeof studio;
  studioLib: typeof studioLib;
  studioSources: typeof studioSources;
  telegram: typeof telegram;
  telegramLib: typeof telegramLib;
  telos: typeof telos;
  telosLib: typeof telosLib;
  transcripts: typeof transcripts;
  workflowLib: typeof workflowLib;
  workflowRunner: typeof workflowRunner;
  workflows: typeof workflows;
  zolaDrafts: typeof zolaDrafts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
