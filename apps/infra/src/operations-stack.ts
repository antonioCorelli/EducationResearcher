import { CfnCondition, CfnOutput, CfnParameter, Duration, Fn, Stack, Tags, type StackProps } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { CfnSubscription, Topic } from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

export interface EducationResearcherOperationsStackProps extends StackProps {
  readonly environment: string;
}

export class EducationResearcherOperationsStack extends Stack {
  constructor(scope: Construct, id: string, props: EducationResearcherOperationsStackProps) {
    super(scope, id, props);

    const alarmPhoneNumber = new CfnParameter(this, "ProductionAlarmPhoneNumber", {
      allowedPattern: "^$|^\\+[1-9][0-9]{7,14}$",
      default: "",
      description: "Optional E.164 phone number for production smoke-test failure SMS alerts.",
      noEcho: true,
      type: "String"
    });
    const hasAlarmPhoneNumber = new CfnCondition(this, "HasProductionAlarmPhoneNumber", {
      expression: Fn.conditionNot(Fn.conditionEquals(alarmPhoneNumber.valueAsString, ""))
    });

    const alarmTopic = new Topic(this, "ProductionSmokeAlarmTopic", {
      displayName: "EducationResearcher production smoke alarms",
      topicName: `education-researcher-${props.environment}-production-smoke-alarms`
    });

    const smsSubscription = new CfnSubscription(this, "ProductionSmokeAlarmSmsSubscription", {
      endpoint: alarmPhoneNumber.valueAsString,
      protocol: "sms",
      topicArn: alarmTopic.topicArn
    });
    smsSubscription.cfnOptions.condition = hasAlarmPhoneNumber;

    const uiLoginFailureMetric = new Metric({
      dimensionsMap: {
        Environment: props.environment
      },
      metricName: "UiLoginFailure",
      namespace: "EducationResearcher/ProductionSmoke",
      period: Duration.minutes(5),
      statistic: "Maximum"
    });

    const uiLoginFailureAlarm = new Alarm(this, "ProductionUiLoginSmokeFailureAlarm", {
      alarmDescription: "Alerts when the production UI smoke test cannot log in from the live login page.",
      alarmName: `education-researcher-${props.environment}-ui-login-smoke-failure`,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      datapointsToAlarm: 1,
      evaluationPeriods: 1,
      metric: uiLoginFailureMetric,
      threshold: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });
    uiLoginFailureAlarm.addAlarmAction(new SnsAction(alarmTopic));

    Tags.of(alarmTopic).add("Environment", props.environment);
    Tags.of(alarmTopic).add("Purpose", "ProductionSmokeAlerting");
    Tags.of(uiLoginFailureAlarm).add("Environment", props.environment);
    Tags.of(uiLoginFailureAlarm).add("Purpose", "ProductionSmokeAlerting");

    new CfnOutput(this, "ProductionSmokeAlarmTopicArn", {
      value: alarmTopic.topicArn
    });

    new CfnOutput(this, "ProductionSmokeMetricNamespace", {
      value: "EducationResearcher/ProductionSmoke"
    });
  }
}
