import "hardhat/types/config";
declare module "hardhat/types/config" {
    interface ProjectPathsUserConfig {
        starknetSources?: string;
    }
    interface ProjectPathsConfig {
        starknetSources: string;
    }
}
//# sourceMappingURL=type-extensions.d.ts.map