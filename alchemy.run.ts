/// <reference types="@types/node" />

import alchemy, { secret } from "alchemy";

import { Worker, Ai, VectorizeIndex, Queue } from "alchemy/cloudflare";
import { ExampleArrayA, ExampleArrayB } from "./src/schemas/example-schemas";

import { GitHubComment } from "alchemy/github";

import { config } from "dotenv";
import { CloudflareStateStore } from "alchemy/state";
config({ path: "./.env" });

const env = process.env;

const Environments = {
  PROD: "production",
  STAGE: "staging",
  DEV: "development",
  TEST: "test",
} as const;

const isEnvProd = env.NODE_ENV === Environments.PROD;

const appName = "<appName>";

const app = await alchemy(appName, {
  password: env.ALCHEMY_SECRET_PASSPHRASE,
  stateStore: isEnvProd
    ? (scope) => new CloudflareStateStore(scope)
    : undefined,
});

const isAppProd = app.stage === Environments.PROD;

// In prod, we never delete resources on deploy
const canDelete = !isAppProd;

const appAi = Ai();

const indexName = `${appName}-<indexName>-index-${app.stage}`;

const appVectorize = await VectorizeIndex(indexName, {
  name: indexName,
  description: "Vectorize index for <use-case>",
  apiToken: secret(env.CLOUDFLARE_API_TOKEN),
  accountId: "<accountId>",
  dimensions: <numDimensions>,
  metric: "<metricType>",
  adopt: true,
  delete: canDelete, // Delete non-prod indexes on deploy
});

// Queues
const queueAName = `<queueAName>-${app.stage}`;
const queueBName = `<queueBName>-${app.stage}`;

const appQueueA = await Queue<ExampleArrayA>(queueAName, {
  name: queueAName,
  adopt: true,
  delete: canDelete,
});

const appQueueB = await Queue<ExampleArrayB>(queueBName, {
  name: queueBName,
  adopt: true,
  delete: canDelete,
});

const workerName = "<workerName>";

const domainExt = isAppProd ? "" : `${app.stage}-`;
const workerDomain = `${domainExt}<appSubdomain>.<myDomain>.com`;

const appWorker = await Worker(workerName, {
  adopt: true,
  entrypoint: "./src/index.ts",
  accountId: "<accountId>",
  compatibilityDate: "2025-09-08",
  observability: { enabled: true },
  domains: [
    {
      domainName: workerDomain,
      zoneId: "<zoneId>",
      adopt: true,
    },
  ],

  dev: {
    port: <portNumber>,
  },

  bindings: {
    // Environment Variables
    API_KEY: secret(env.API_KEY),
    SENTRY_DSN: "<sentryDsnUrl>",

    // Cloudflare bindings
    AI: appAi,
    VECTOR_INDEX: appVectorize,
    QUEUE_A: appQueueA,
    QUEUE_B: appQueueB,
  },
  eventSources: [
    {
      queue: appQueueA,
      settings: { batchSize: 10, maxWaitTimeMs: 60 * 1000 },
      adopt: true,
      delete: canDelete,
    },
    {
      queue: appQueueB,
      settings: { batchSize: 10, maxWaitTimeMs: 60 * 1000 },
      adopt: true,
      delete: canDelete,
    },
  ],
});

export type envs = typeof appWorker.Env;

console.log(`✅ Worker deployed at: ${appWorker.url}`);

// Optionally post a GitHub comment with the deployed preview URL
if (process.env.PULL_REQUEST) {
  const previewUrl = appWorker.url;

  await GitHubComment("<githubCommentName>", {
    owner: process.env.GITHUB_REPOSITORY_OWNER || "<orgName>",
    repository: process.env.GITHUB_REPOSITORY_NAME || "<repoName>",
    issueNumber: Number(process.env.PULL_REQUEST),
    body: `
          ## 🚀 Preview Deployed

          Your preview is ready! 

          **Preview URL:** ${previewUrl}

          This preview was built from commit ${process.env.GITHUB_SHA}

          ---
          <sub>🤖 This comment will be updated automatically when you push new commits to this PR.</sub>
          <sub>🚀 Environment: ${app.stage}</sub>
          `,
  });
}

await app.finalize();
