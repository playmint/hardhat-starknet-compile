import "hardhat/types/config";
declare module "hardhat/types/config" {
    interface ProjectPathsUserConfig {
        starknetSources?: string;
        starknetArtifacts?: string;
    }
    interface ProjectPathsConfig {
        starknetSources: string;
        starknetArtifacts: string;
    }
}
//# sourceMappingURL=type-extensions.d.ts.map