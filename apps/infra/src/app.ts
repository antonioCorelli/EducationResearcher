import { App } from "aws-cdk-lib";
import { EducationResearcherArtifactStack } from "./artifact-stack.js";
import { EducationResearcherAuthStack } from "./auth-stack.js";
import { EducationResearcherDataStack } from "./data-stack.js";
import { EducationResearcherOperationsStack } from "./operations-stack.js";

const app = new App();
const environment = app.node.tryGetContext("environment")?.toString() ?? "dev";

new EducationResearcherAuthStack(app, `EducationResearcherAuth-${environment}`, {
  environment
});

new EducationResearcherDataStack(app, `EducationResearcherData-${environment}`, {
  environment
});

new EducationResearcherArtifactStack(app, `EducationResearcherArtifacts-${environment}`, {
  environment
});

new EducationResearcherOperationsStack(app, `EducationResearcherOperations-${environment}`, {
  environment
});
