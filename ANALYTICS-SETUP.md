# Vercel Web Analytics Setup

This document describes the Vercel Web Analytics integration for this website.

## Overview

Vercel Web Analytics has been integrated into this static HTML website to track page views, visitor data, and site performance.

## Implementation

### Files Added

1. **analytics.js** - Source file that imports and initializes Vercel Analytics
2. **analytics-bundle.js** - Bundled version for browser use (generated from analytics.js)
3. **add-analytics.py** - Python script used to add analytics to all HTML files (can be removed if desired)

### Files Modified

- All HTML files (14 total) now include the analytics script tag in the `<head>` section:
  ```html
  <!-- Vercel Web Analytics -->
  <script type="module" src="/analytics-bundle.js"></script>
  ```

- **package.json** - Added scripts for building the analytics bundle:
  - `build:analytics` - Bundles the analytics script
  - `prebuild` - Automatically runs before build

### Dependencies

- `@vercel/analytics` (^2.0.1) - Vercel Web Analytics package
- `esbuild` (^0.28.2) - Bundler for creating the browser-ready analytics script

## Usage

### Building

To rebuild the analytics bundle after making changes to `analytics.js`:

```bash
npm run build:analytics
```

### Deployment

When deploying to Vercel:

1. Ensure Web Analytics is enabled in your Vercel project dashboard
2. Deploy the site normally
3. Analytics will automatically start tracking once deployed

### Configuration

The analytics are initialized with the following settings (in `analytics.js`):

```javascript
inject({
  mode: 'auto',  // Auto-detect environment (production/development)
  debug: false   // Set to true for debug logging in development
});
```

You can modify these settings in `analytics.js` and rebuild using `npm run build:analytics`.

## How It Works

1. The `analytics.js` file imports the `inject` function from `@vercel/analytics`
2. The file is bundled using esbuild to create `analytics-bundle.js`
3. All HTML pages load this bundle as an ES module
4. The analytics script automatically tracks page views and sends data to Vercel
5. When deployed to Vercel with Web Analytics enabled, the script connects to Vercel's analytics infrastructure

## Vercel Dashboard

After deployment, view analytics data in:
- Your Vercel project dashboard → Analytics tab
- Real-time visitor data
- Page view statistics
- Top pages and referrers
- Geographic distribution

## Notes

- Analytics data only appears after the site is deployed to Vercel and Web Analytics is enabled in the dashboard
- The bundled file (`analytics-bundle.js`) should be committed to the repository
- The script automatically detects production vs development environments
- No personal data is collected; all tracking is privacy-friendly
