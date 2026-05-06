import { CfnOutput, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import {
  AccountRecovery,
  OAuthScope,
  UserPool,
  UserPoolClient,
  VerificationEmailStyle
} from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";

export interface EducationResearcherAuthStackProps extends StackProps {
  readonly environment: string;
}

export class EducationResearcherAuthStack extends Stack {
  readonly userPool: UserPool;
  readonly researcherClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: EducationResearcherAuthStackProps) {
    super(scope, id, props);

    this.userPool = new UserPool(this, "ResearcherUserPool", {
      userPoolName: `education-researcher-${props.environment}-researchers`,
      selfSignUpEnabled: false,
      signInAliases: {
        email: true
      },
      signInCaseSensitive: false,
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        },
        fullname: {
          required: false,
          mutable: true
        }
      },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      userVerification: {
        emailStyle: VerificationEmailStyle.CODE
      },
      removalPolicy: props.environment === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    this.researcherClient = this.userPool.addClient("ResearcherWebClient", {
      userPoolClientName: `education-researcher-${props.environment}-researcher-web`,
      authFlows: {
        userPassword: true,
        userSrp: true
      },
      oAuth: {
        scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE]
      },
      preventUserExistenceErrors: true
    });

    Tags.of(this.userPool).add("AccessSurface", "Researcher");
    Tags.of(this.userPool).add("Environment", props.environment);

    new CfnOutput(this, "ResearcherUserPoolId", {
      value: this.userPool.userPoolId
    });

    new CfnOutput(this, "ResearcherUserPoolClientId", {
      value: this.researcherClient.userPoolClientId
    });
  }
}

