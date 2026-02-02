const marked = require('/root/development/oc/octools/webapp/node_modules/marked/lib/marked.cjs');

// Test markdown input
const testInput = `Here's a test with lists:

- First item
- Second item
- Third item

1. Numbered one
2. Numbered two
3. Numbered three

Mixed content:
- Item with **bold**
- Item with \`code\`
- Item with *italic*

After the list.`;

// Custom function from the working version
function formatSelectiveMarkdown(text) {
    if (!text) return text;
    
    let html = text;
    
    // Escape HTML to prevent injection
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Format code blocks - MUST come before inline code
    html = html.replace(/\`\`\`(\w+)?\n([\s\S]*?)\`\`\`/g, function(match, lang, code) {
        return '<pre><code class="language-' + (lang || 'text') + '">' + code.trim() + '</code></pre>';
    });
    
    // Format inline code
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    
    // Format bold + italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    
    // Format bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    
    // Format italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');
    
    // Format headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // Format unordered lists
    html = html.replace(/^([*\-+]) (.+)$/gm, '<li>$2</li>');
    
    // Format ordered lists
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    
    // Wrap consecutive <li> tags in <ul> or <ol>
    html = html.replace(/(<li>.*?<\/li>\n?)+/g, function(match) {
        // CRITICAL: Remove newlines inside the list to prevent <br> tags between items
        return '<ul>' + match.replace(/\n/g, '') + '</ul>';
    });
    
    // Convert newlines to <br> for display
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

console.log("=== MARKED.JS OUTPUT ===");
const markedOutput = marked.marked(testInput);
console.log(markedOutput);
console.log("\n");

console.log("=== CUSTOM FUNCTION OUTPUT ===");
const customOutput = formatSelectiveMarkdown(testInput);
console.log(customOutput);
console.log("\n");

// Count line breaks and list structure
console.log("=== ANALYSIS ===");
console.log("Marked.js:");
console.log("- Contains <p> tags:", markedOutput.includes('<p>'));
console.log("- Number of <p> tags:", (markedOutput.match(/<p>/g) || []).length);
console.log("- Number of </p> tags:", (markedOutput.match(/<\/p>/g) || []).length);
console.log("- Contains newlines in HTML:", markedOutput.includes('\n'));
console.log("- Number of newlines:", (markedOutput.match(/\n/g) || []).length);

console.log("\nCustom function:");
console.log("- Contains <p> tags:", customOutput.includes('<p>'));
console.log("- Contains <br> tags:", customOutput.includes('<br>'));
console.log("- Number of <br> tags:", (customOutput.match(/<br>/g) || []).length);
console.log("- Contains newlines in HTML:", customOutput.includes('\n'));