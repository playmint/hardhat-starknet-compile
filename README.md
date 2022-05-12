# hardhat-starknet-compile
A plugin for hardhat which modifies the standard Hardhat `compile` task to compile your Starknet contracts after your Solidity contracts. It also only compiles the Starknet contracts which have actually changed.

## Installation
Install with npm:

`npm i --save-dev @playmint/hardhat-starknet-compile`

Then import in your hardhat.config file:

```ts
import "@playmint/hardhat-starknet-compile";
```

## How to use
This plugin hooks in to Hardhat's `compile` task, but if you want you can run the task `starknet-compile` to compile your Starknet contracts only.

Only contracts which have changed (or their dependencies have) will be compiled, if you want to force a contract to recompile you can delete its .json files which will be in the Starknet artifacts directory, or delete the cairo files cache.

If you use a python venv for your starknet development environment, make sure you launch vscode from your venv.

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
