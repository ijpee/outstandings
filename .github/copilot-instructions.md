<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# CSV Processing Tool Instructions

This is a minimal CSV processing tool built with vanilla HTML, CSS, and JavaScript. The project has the following constraints:

- **No external dependencies or frameworks** - Use only native web technologies
- **Minimal code approach** - Keep the codebase as simple and lightweight as possible
- **Browser-based processing** - All CSV processing happens client-side

## Key Components

- `index.html` - Main interface with file upload and processing controls
- `style.css` - Simple, clean styling without any CSS frameworks
- `script.js` - Pure JavaScript for CSV parsing, processing, and download functionality

## Code Guidelines

- Use vanilla JavaScript only (no jQuery, lodash, etc.)
- Keep functions small and focused
- Handle errors gracefully with user-friendly messages
- Maintain responsive design with simple CSS
- Process files entirely in the browser (no server required)

## CSV Processing Logic

The main processing function `transformData()` is where custom formatting logic should be implemented. Currently it includes a simple example that:
- Converts text to uppercase
- Adds a processed date column

Modify this function based on your specific CSV transformation requirements.
