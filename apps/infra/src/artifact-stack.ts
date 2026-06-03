import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership
} from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export interface EducationResearcherArtifactStackProps extends StackProps {
  readonly environment: string;
}

export class EducationResearcherArtifactStack extends Stack {
  readonly artifactBucket: Bucket;

  constructor(scope: Construct, id: string, props: EducationResearcherArtifactStackProps) {
    super(scope, id, props);

    this.artifactBucket = new Bucket(this, "ArtifactBucket", {
      bucketName: `education-researcher-${props.environment}-artifacts-${this.account}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: props.environment === "prod",
      lifecycleRules: [
        {
          id: "DefaultArtifactRetention",
          enabled: true,
          expiration: Duration.days(730),
          prefix: ""
        }
      ],
      removalPolicy: props.environment === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    Tags.of(this.artifactBucket).add("DataClassification", "SensitiveStudyArtifact");
    Tags.of(this.artifactBucket).add("Environment", props.environment);
    Tags.of(this.artifactBucket).add("ArtifactPrefixes", "audio_exports");

    new CfnOutput(this, "ArtifactBucketName", {
      value: this.artifactBucket.bucketName
    });

    new CfnOutput(this, "AudioArtifactPrefix", {
      value: "audio/"
    });

    new CfnOutput(this, "ExportArtifactPrefix", {
      value: "exports/"
    });
  }
}
