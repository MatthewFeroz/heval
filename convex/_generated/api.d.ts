/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as presentationExports from "../presentationExports.js";
import type * as presentationExportWorker from "../presentationExportWorker.js";
import type * as reportAccess from "../reportAccess.js";
import type * as onboarding from "../onboarding.js";
import type * as reportProjects from "../reportProjects.js";
import type * as reports from "../reports.js";
import type * as runnerValidators from "../runnerValidators.js";
import type * as experiments from "../experiments.js";
import type * as runners from "../runners.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  presentationExports: typeof presentationExports;
  presentationExportWorker: typeof presentationExportWorker;
  onboarding: typeof onboarding;
  reportAccess: typeof reportAccess;
  reportProjects: typeof reportProjects;
  reports: typeof reports;
  runnerValidators: typeof runnerValidators;
  runners: typeof runners;
  experiments: typeof experiments;
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
