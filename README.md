# CSV File Processor

**Internal Tool - Lightweight & Simple by Design**

A minimal, dependency-free web application for processing CSV files internally. This tool prioritizes simplicity over robustness - it's designed for quick internal use with minimal error handling and validation.

⚠️ **Note**: This is an internal utility tool. It assumes well-formed CSV input and trusted usage. No extensive error validation or edge case handling.

## Features

- **Zero Dependencies**: Built with vanilla HTML, CSS, and JavaScript
- **Ultra Lightweight**: Minimal code, maximum simplicity
- **Client-Side Processing**: All CSV processing happens in the browser
- **Basic File Upload**: Simple file selection interface
- **Quick Preview**: View processed data before downloading
- **Easy Customization**: Modify transformation logic as needed

## Usage

1. Open `index.html` in your web browser
2. Click "Choose CSV File" and select your CSV file
3. Click "Process File" to transform the data
4. Preview the results in the table
5. Click "Download Processed CSV" to save the transformed file

## Customization

The main processing logic is in the `transformData()` function in `script.js`. Modify this function to implement your specific CSV transformation requirements.

### Example Transformation

The current example transformation:
- Converts all text to uppercase
- Adds a "Processed_Date" column with the current date

```javascript
function transformData(data) {
    // Your custom transformation logic here
    const headers = data[0];
    const rows = data.slice(1);
    
    const newHeaders = [...headers, 'Processed_Date'];
    const newRows = rows.map(row => {
        const transformedRow = row.map(cell => cell.toUpperCase());
        transformedRow.push(new Date().toISOString().split('T')[0]);
        return transformedRow;
    });
    
    return [newHeaders, ...newRows];
}
```

## Project Structure

```
outstandings/
├── index.html          # Main HTML interface
├── style.css           # Styling and layout
├── script.js           # JavaScript functionality
├── README.md           # This file
└── .github/
    └── copilot-instructions.md
```

## Browser Compatibility

This tool works in all modern browsers that support:
- File API
- Blob API
- ES6+ JavaScript features

## Development Philosophy

**Keep It Simple**: This tool intentionally avoids over-engineering. It's designed for:
- Internal team use with trusted CSV files
- Quick transformations without extensive validation
- Minimal code maintenance
- Fast iteration and customization

No build process or dependencies required. Simply edit the files and refresh your browser to see changes.

## License

Open source - feel free to modify and use as needed.
