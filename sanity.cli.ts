import { defineCliConfig } from 'sanity/cli';
import 'dotenv/config';
export default defineCliConfig({
  api: {
    projectId:
      process.env.SANITY_STUDIO_PROJECT_ID || process.env.SANITY_PROJECT_ID || 'missingproject',
    dataset: process.env.SANITY_DATASET || 'production',
  },
});
