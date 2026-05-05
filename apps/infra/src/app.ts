import { App } from "aws-cdk-lib";
import { EducationResearcherDataStack } from "./data-stack.js";

const app = new App();
const environment = app.node.tryGetContext("environment")?.toString() ?? "dev";

new EducationResearcherDataStack(app, `EducationResearcherData-${environment}`, {
  environment
});
