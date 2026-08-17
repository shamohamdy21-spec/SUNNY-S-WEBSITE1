#!/usr/bin/env python3
"""
Script to add Vercel Analytics to all HTML files
"""
import os
import glob

# The analytics script tag to add
analytics_script = """<!-- Vercel Web Analytics -->
<script type="module" src="/analytics-bundle.js"></script>
"""

# Get all HTML files
html_files = glob.glob("*.html")

for html_file in html_files:
    print(f"Processing {html_file}...")
    
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if analytics is already added
    if 'analytics-bundle.js' in content:
        print(f"  Analytics already present in {html_file}, skipping...")
        continue
    
    # Add the analytics script before </head>
    if '</head>' in content:
        content = content.replace('</head>', analytics_script + '</head>')
        
        with open(html_file, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"  ✓ Added analytics to {html_file}")
    else:
        print(f"  ✗ No </head> tag found in {html_file}")

print("\nDone!")
