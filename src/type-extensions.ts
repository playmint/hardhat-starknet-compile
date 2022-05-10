import "hardhat/types/config";

declare module "hardhat/types/config" {
    export interface ProjectPathsUserConfig {
        starknetSources?: string;
        starknetArtifacts?: string;
    }

    export interface ProjectPathsConfig {
        starknetSources: string;
        starknetArtifacts: string;
    }
}