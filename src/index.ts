import { subtask, task, types } from "hardhat/config";
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";
import fs from "fs";
import { exec } from "child_process";
import path from "path"

export const TASK_STARKNET_COMPILE: string = "starknet-compile";
export const TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES: string = "starknet-compile:gather-cairo-files";
export const TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE: string = "starknet-compile:get-files-to-compile";
export const TASK_STARKNET_COMPILE_COMPILE: string = "starknet-compile:compile";

// hook into normal compile task
task(TASK_COMPILE)
    .setAction(async (args, hre, runSuper) => {
        await runSuper();

        await hre.run(TASK_STARKNET_COMPILE);
    });

// standalone compile task
task(TASK_STARKNET_COMPILE)
    .setAction(async (args, hre) => {
        const cairoFiles: string[] = await hre.run(TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES);
        console.log(cairoFiles);
        const toCompile: string[] = await hre.run(TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE, { sources: cairoFiles });
        console.log(toCompile);
        await hre.run(TASK_STARKNET_COMPILE_COMPILE, { sources: toCompile });
    });

// first gather files
subtask(TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES)
    .setAction(async () => {
        // TODO configurable contract dirs
        const findCairoFilesInDir = (dir: string): string[] => {
            let cairoFiles: string[] = [];
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const path = `${dir}/${entry.name}`;
                if (entry.isDirectory()) {
                    cairoFiles = cairoFiles.concat(findCairoFilesInDir(path));
                }
                else if (entry.name.endsWith(".cairo")) {
                    cairoFiles.push(path);
                }
            }

            return cairoFiles;
        };

        const contractDirs = ["contracts"];
        let cairoFiles: string[] = [];
        for (const contractDir of contractDirs) {
            cairoFiles = cairoFiles.concat(findCairoFilesInDir(contractDir));
        }

        return cairoFiles;
    });

// TODO check there's a valid compiler

// see what has changed
subtask(TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE)
    .addParam("sources", undefined, undefined, types.any)
    .setAction(async (args: { sources: string[] }): Promise<string[]> => {
        console.log(args);
        return args.sources;
    });

// compile files
// TODO concurrency
subtask(TASK_STARKNET_COMPILE_COMPILE)
    .addParam("sources", undefined, undefined, types.any)
    .setAction(async (args: { sources: string[] }) => {
        // TODO configurable
        const artifactsDir = "artifacts-starknet";

        for (const source of args.sources) {
            // TODO configurable artifacts dir
            console.log(source);
            const outFile = `${artifactsDir}/${source.substring(0, source.length - 6)}.json`;
            const outDir = path.dirname(outFile);
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }

            await new Promise((resolve, reject) => {
                exec(`starknet-compile "${source}" --output "${outFile}"`, (error, stdout) => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        resolve(stdout);
                    }
                });
            });
        }
    });