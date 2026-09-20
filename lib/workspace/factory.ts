import type { RuntimeMode } from "../config/runtime";
import type { Repositories } from "../repositories/contracts";
import { demoCalendarProvider, demoEmailProvider } from "./demo";
import { GoogleCalendarProvider, GoogleGmailProvider } from "./google";
export function createWorkspaceProviders(repositories: Repositories, mode: RuntimeMode) { return mode === "demo" ? { email: demoEmailProvider, calendar: demoCalendarProvider } : { email: new GoogleGmailProvider(repositories), calendar: new GoogleCalendarProvider(repositories) }; }
