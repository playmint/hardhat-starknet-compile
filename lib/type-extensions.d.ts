import "hardhat/types/config";
declare module "hardhat/types/config" {
    interface ProjectPathsUserConfig {
        starknetSources?: string;
        starknetArtifacts?: string;
        cairoPath?: string[];
    }
    interface ProjectPathsConfig {
        starknetSources: string;
        starknetArtifacts: string;
        cairoPath: string[];
    }
}
//# sourceMappingURL=type-extensions.d.ts.map