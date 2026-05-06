import { App } from "aws-cdk-lib";
import { EducationResearcherAuthStack } from "./auth-stack.js";
import { EducationResearcherDataStack } from "./data-stack.js";

const app = new App();
const environment = app.node.tryGetContext("environment")?.toString() ?? "dev";

new EducationResearcherAuthStack(app, `EducationResearcherAuth-${environment}`, {
  environment
});

new EducationResearcherDataStack(app, `EducationResearcherData-${environment}`, {
  environment
});
