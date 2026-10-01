// Stryker plugin: the stock Vitest runner with its per-test name filter switched off.
// @stryker-mutator/vitest-runner 10.0.0 builds `testNamePattern` from suite and test names
// joined by a space; Vitest 5 matches that pattern against names joined by " > ". Every test
// inside a `describe` is then skipped, no test fails, and each mutant is reported as survived.
// Here a mutant run executes the whole test files that hold its covering tests instead.
// Delete this file, and point `testRunner` back at "vitest", once the upstream runner
// supports Vitest 5.

import { commonTokens, declareFactoryPlugin, PluginKind, tokens } from "@stryker-mutator/api/plugin";
import { strykerPlugins as upstreamPlugins } from "@stryker-mutator/vitest-runner";

const upstream = upstreamPlugins.find((plugin) => plugin.name === "vitest");

function createRunner(injector) {
  const runner = injector.injectFunction(upstream.factory);
  const run = runner.run.bind(runner);
  runner.run = ({ testIds = [], testFiles, ...rest } = {}) =>
    run({
      ...rest,
      testFiles: testIds.length > 0 ? [...new Set(testIds.map((id) => id.split("#")[0]))] : testFiles,
    });
  return runner;
}
createRunner.inject = tokens(commonTokens.injector);

export const strykerPlugins = [declareFactoryPlugin(PluginKind.TestRunner, "vitest5", createRunner)];
