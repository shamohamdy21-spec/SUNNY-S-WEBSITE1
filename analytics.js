/**
 * Vercel Web Analytics initialization
 * This script loads and initializes Vercel Analytics for the website
 */

// Import the inject function from @vercel/analytics
import { inject } from '@vercel/analytics';

// Initialize Vercel Analytics
inject({
  mode: 'auto', // Automatically detect environment (production/development)
  debug: false  // Set to true to enable debug logging in development
});
