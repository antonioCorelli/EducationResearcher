import {
  CognitoIdentityProviderClient,
  GlobalSignOutCommand,
  InitiateAuthCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type ResearcherRole = "researcher";

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: ResearcherRole;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly idToken: string;
  readonly refreshToken?: string;
  readonly expiresIn: number;
  readonly tokenType: string;
}

export interface AuthProvider {
  signIn(email: string, password: string): Promise<AuthTokens>;
  signOut(accessToken: string): Promise<void>;
  verifyAccessToken(accessToken: string): Promise<SessionUser>;
}

export class AuthenticationError extends Error {
  constructor(message = "Authentication failed.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface CognitoAuthProviderConfig {
  readonly region: string;
  readonly userPoolId: string;
  readonly clientId: string;
}

export class CognitoAuthProvider implements AuthProvider {
  private readonly client: CognitoIdentityProviderClient;
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: CognitoAuthProviderConfig) {
    this.client = new CognitoIdentityProviderClient({
      region: config.region
    });
    this.issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async signIn(email: string, password: string): Promise<AuthTokens> {
    try {
      const response = await this.client.send(
        new InitiateAuthCommand({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: this.config.clientId,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password
          }
        })
      );

      const result = response.AuthenticationResult;

      if (!result?.AccessToken || !result.IdToken || !result.ExpiresIn || !result.TokenType) {
        throw new AuthenticationError();
      }

      return {
        accessToken: result.AccessToken,
        idToken: result.IdToken,
        refreshToken: result.RefreshToken,
        expiresIn: result.ExpiresIn,
        tokenType: result.TokenType
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError();
    }
  }

  async signOut(accessToken: string): Promise<void> {
    try {
      await this.client.send(
        new GlobalSignOutCommand({
          AccessToken: accessToken
        })
      );
    } catch {
      throw new AuthenticationError();
    }
  }

  async verifyAccessToken(accessToken: string): Promise<SessionUser> {
    try {
      const { payload } = await jwtVerify(accessToken, this.jwks, {
        issuer: this.issuer
      });

      if (payload.token_use !== "access" || payload.client_id !== this.config.clientId || !payload.sub) {
        throw new AuthenticationError();
      }

      const email = typeof payload.email === "string" ? payload.email : "";
      const displayName =
        typeof payload.name === "string" && payload.name.trim().length > 0 ? payload.name : email || "Researcher";

      return {
        id: payload.sub,
        email,
        displayName,
        role: "researcher"
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError("Invalid or expired session.");
    }
  }
}

export function createConfiguredAuthProvider() {
  const region = process.env.AWS_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;

  if (!region || !userPoolId || !clientId) {
    throw new Error("AWS_REGION, COGNITO_USER_POOL_ID, and COGNITO_CLIENT_ID are required.");
  }

  return new CognitoAuthProvider({
    region,
    userPoolId,
    clientId
  });
}

