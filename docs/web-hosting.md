# Web Hosting

Source issue: [#66](https://github.com/antonioCorelli/EducationResearcher/issues/66)

## Decision

Host the React/Vite web app with AWS Amplify Hosting. The Service API is hosted separately on AWS Elastic Beanstalk and
is exposed at `https://api.voxaria.io`.

Amplify should only serve the static web app from `apps/web/dist`. It should not run the Service API, store service
secrets, or proxy participant data. The frontend build receives the public API origin through `VITE_SERVICE_BASE_URL`.

## Repository Build Settings

The repository root includes `amplify.yml` for the production web app. Amplify's monorepo app root must be `apps/web`
and the build path is `/` so npm workspaces install from the repository root.

Expected production settings:

```text
AMPLIFY_MONOREPO_APP_ROOT=apps/web
VITE_SERVICE_BASE_URL=https://api.voxaria.io
Node runtime=20
Build command=npm run build --workspace @education-researcher/web
Output directory=apps/web/dist
```

The committed build spec runs:

```bash
nvm install 20
nvm use 20
npm ci
npm run build --workspace @education-researcher/web
```

## Initial Amplify Deployment

Create the Amplify app in `us-east-1` from the GitHub repository `antonioCorelli/EducationResearcher` and connect the
intended production branch. In the Amplify console:

1. Select **My app is a monorepo**.
2. Set the app root to `apps/web`.
3. Confirm `AMPLIFY_MONOREPO_APP_ROOT=apps/web`.
4. Confirm `VITE_SERVICE_BASE_URL=https://api.voxaria.io`.
5. Use the repository `amplify.yml` build settings.
6. Deploy and verify the Amplify default domain before adding `voxaria.io`.

For direct participant links such as `/participant/runs/<token>`, configure an Amplify Hosting rewrite to serve the SPA
entrypoint for non-asset routes:

```json
[
  {
    "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
    "status": "200",
    "target": "/index.html",
    "condition": null
  }
]
```

## Verification

Before custom DNS:

1. Open the Amplify default domain.
2. Confirm the researcher sign-in screen renders.
3. Attempt a researcher sign-in with a non-secret test credential path and confirm network requests go to
   `https://api.voxaria.io`, not `localhost`.
4. Open a non-real participant test link in the form `/participant/runs/<token>` and confirm the route is served by the
   web app rather than an Amplify 404.
5. After the Service API is verified on Elastic Beanstalk, complete a non-real participant smoke test before collecting
   real participant data.

Do not add `voxaria.io` custom DNS until the Amplify default domain and the Elastic Beanstalk `api.voxaria.io` health
check are both verified.
