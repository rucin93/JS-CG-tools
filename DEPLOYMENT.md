# Deploying to GitHub Pages

This project is configured to deploy to GitHub Pages automatically.

## Setup Instructions

1. **Update the base path** in `next.config.mjs`:
   - Change `basePath: '/regpack'` to match your repository name
   - If your repo is `username/my-repo`, use `basePath: '/my-repo'`

2. **Enable GitHub Pages** in your repository:
   - Go to Settings → Pages
   - Set Source to "GitHub Actions"

3. **Push to main branch**:
   - The GitHub Action will automatically build and deploy
   - Your site will be available at `https://username.github.io/repo-name/`

## Manual Deployment

If you prefer to deploy manually:

\`\`\`bash
# Build the project
npm run build

# The static files will be in the 'out' directory
# Push the 'out' directory to the gh-pages branch
\`\`\`

## Local Testing

To test the production build locally:

\`\`\`bash
npm run build
npx serve out
\`\`\`

## Troubleshooting

- If styles are missing, verify the basePath matches your repo name
- If pages aren't loading, check that GitHub Pages is set to "GitHub Actions" source
- If the Action fails, check the Actions tab for error logs
