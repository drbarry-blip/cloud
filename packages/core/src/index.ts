// Browser-safe exports: pure logic and types. Node-only code lives in "@cgs/core/node",
// and HTML detection (which pulls in an HTML parser) in "@cgs/core/detect".
export * from "./playbook/schema";
export type { Playbook } from "./playbook/load";
export * from "./reply-checker/check";
export * from "./reply-checker/templates";
export * from "./visibility/score";
export * from "./playbook/shopper-schema";
export * from "./shopper";
