"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_STARKNET_COMPILE_COMPILE = exports.TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE = exports.TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES = exports.TASK_STARKNET_COMPILE = void 0;
const config_1 = require("hardhat/config");
const plugins_1 = require("hardhat/plugins");
const task_names_1 = require("hardhat/builtin-tasks/task-names");
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
exports.TASK_STARKNET_COMPILE = "starknet-compile";
exports.TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES = "starknet-compile:gather-cairo-files";
exports.TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE = "starknet-compile:get-files-to-compile";
exports.TASK_STARKNET_COMPILE_COMPILE = "starknet-compile:compile";
// hook into normal compile task
(0, config_1.task)(task_names_1.TASK_COMPILE)
    .setAction(async (args, hre, runSuper) => {
    await runSuper();
    await hre.run(exports.TASK_STARKNET_COMPILE);
});
// standalone compile task
(0, config_1.task)(exports.TASK_STARKNET_COMPILE)
    .setAction(async (args, hre) => {
    const cairoFiles = await hre.run(exports.TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES);
    const toCompile = await hre.run(exports.TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE, { sources: cairoFiles });
    await hre.run(exports.TASK_STARKNET_COMPILE_COMPILE, { sources: toCompile });
});
// first gather files
(0, config_1.subtask)(exports.TASK_STARKNET_COMPILE_GATHER_CAIRO_FILES)
    .setAction(async () => {
    // TODO configurable contract dirs
    const findCairoFilesInDir = (dir) => {
        let cairoFiles = [];
        const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
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
    let cairoFiles = [];
    for (const contractDir of contractDirs) {
        cairoFiles = cairoFiles.concat(findCairoFilesInDir(contractDir));
    }
    return cairoFiles;
});
// TODO check there's a valid compiler
// see what has changed
(0, config_1.subtask)(exports.TASK_STARKNET_COMPILE_GET_FILES_TO_COMPILE)
    .addParam("sources", undefined, undefined, config_1.types.any)
    .setAction(async (args) => {
    return args.sources;
});
// compile files
// TODO concurrency
(0, config_1.subtask)(exports.TASK_STARKNET_COMPILE_COMPILE)
    .addParam("sources", undefined, undefined, config_1.types.any)
    .setAction(async (args) => {
    // TODO configurable
    const artifactsDir = "artifacts-starknet";
    let cache = {}; // TODO need to pass this in from parent task so it can written to disk regardless of exceptions
    for (const source of args.sources) {
        // TODO configurable artifacts dir
        console.log(source);
        const outFile = `${artifactsDir}/${source.substring(0, source.length - 6)}.json`;
        const outDir = path_1.default.dirname(outFile);
        if (!fs_1.default.existsSync(outDir)) {
            fs_1.default.mkdirSync(outDir, { recursive: true });
        }
        try {
            await new Promise((resolve, reject) => {
                (0, child_process_1.exec)(`starknet-compile "${source}" --output "${outFile}" --cairo_dependencies deps.txt`, (error, stdout) => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        resolve(stdout);
                    }
                });
            });
        }
        catch (error) {
            const exc = error;
            // remove the "command failed etc" line, we already know that
            let msgRows = exc.message.split("\n");
            if (msgRows[0].startsWith("Command failed: starknet-compile ")) {
                msgRows = msgRows.slice(1);
            }
            throw new plugins_1.HardhatPluginError("hardhat-starknet-compile", "compilation of cairo contracts failed: \n" + msgRows.join("\n"));
        }
        let deps = {};
        const depsRows = fs_1.default.readFileSync("deps.txt").toString().split("\n");
        fs_1.default.rmSync("deps.txt");
        // note, these deps include the current file, which is why we don't 
        // explicitly hash it
        for (let i = 0; i < depsRows.length; ++i) {
            const depsRow = depsRows[i].trim();
            // ignore any empty row
            // ignore the SET (DEPENDENCIES line at the start, and the closing )
            if (depsRow.length == 0 ||
                ["SET (DEPENDENCIES", ")"].indexOf(depsRow) != -1) {
                continue;
            }
            const stats = fs_1.default.statSync(depsRows[i]);
            const hash = (0, crypto_1.createHash)("md5").update(fs_1.default.readFileSync(depsRows[i])).digest().toString("hex");
            deps[depsRows[i]] = {
                lastModificationTime: stats.mtime.getTime(),
                hash: hash
            };
        }
        cache[source] = {
            dependencies: deps
        };
    }
    // TODO is the cache dir folder configurable?
    fs_1.default.writeFileSync("./cache/cairo-files-cache.json", JSON.stringify(cache, null, 4));
});
//# sourceMappingURL=index.js.map