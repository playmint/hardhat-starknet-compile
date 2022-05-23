![](https://raw.githubusercontent.com/playmint/hardhat-starknet-compile/main/hardhat-starknet-compile.png)

[![NPM Package](https://img.shields.io/npm/v/@playmint/hardhat-starknet-compile.svg?style=flat-square)](https://www.npmjs.com/package/@playmint/hardhat-starknet-compile)
---
# hardhat-starknet-compile
A plugin for hardhat which compiles your StarkNet contracts for you.

## How it Works
When you run a script with Hardhat (e.g. `npx hardhat run scripts/deploy.ts`), Hardhat automatically runs the `compile` task which compiles any Solidity contracts which have changed since the last time compilation occurred. This plugin creates a new task called `starknet-compile` which does the same thing for your StarkNet contracts (compiles them, but only the ones which have changed since the last time the task was run). It also extends Hardhat's `compile` task so that it runs `starknet-compile` straight after, this means that whenever you run a script with Hardhat, both your Solidity and StarkNet contracts will be compiled.

## Installation
Install with npm:

`npm i --save-dev @playmint/hardhat-starknet-compile`

Then import in your hardhat.config file:

```ts
import "@playmint/hardhat-starknet-compile";
```

## How to use
- run a script and your StarkNet contracts will be automatically compiled if necessary (e.g. `npx hardhat run scripts/deploy.ts`), or
- run the `compile` task (`npx hardhat compile`), or
- run the `starknet-compile` task (`npx hardhat starknet-compile`)

The artifacts created can be used with [StarkNet.js](https://www.starknetjs.com/), or with [starknet-hardhat-plugin](https://github.com/Shard-Labs/starknet-hardhat-plugin).

Only contracts which have changed (or their dependencies have) will be compiled, if you want to force a contract to recompile you can delete its .json files which will be in the Starknet artifacts directory, or delete the cairo files cache.

If you use a python venv for your starknet development environment, make sure you launch vscode from your venv.

## Using with [starknet-hardhat-plugin](https://github.com/Shard-Labs/starknet-hardhat-plugin)
This plugin can be used alongside starknet-hardhat-plugin, the artifacts it outputs are in a compatible layout such that starknet-hardhat-plugin will find them for contract factories etc. The only thing to know is that you should import `hardhat-starknet-compile` *after* `starknet-hardhat-plugin`, this is because both of these plugins define a task called `starknet-compile`, so if you import them in the wrong order then the version of `starknet-compile` that is executed will be the one from `starknet-hardhat-plugin` which compiles all StarkNet contracts regardless of whether they've changed or not.

## Configuration
By default the plugin will look for Starknet contracts in Hardhat's `sources` path (by default this is `contracts`). You can change this in your Hardhat config by setting `starknetSources` in `paths`.

By default the plugin will save build artifacts of Starknet contracts to `artifacts-starknet`, you can change this in your Hardhat config by setting `starknetArtifacts` in `paths`.

When the starknet compiler is invoked, the working directory used is the root directory of the project. The plugin passes the Starknet sources path as `--cairo_path`, but you can add extra paths to this in your Hardhat config by adding them to `cairoPath` in `paths`.

```ts
import { HardhatUserConfig } from "hardhat/types";
import "@playmint/starknet-hardhat-compile";


const config: HardhatUserConfig = {
    paths: {
        starknetSources: "starknetContracts",
        starknetArtifacts: "artifactsDir",
        cairoPath: ["starknet-libs", "thirdparty-starknet-libs"]
    }
}

export default config;
```
