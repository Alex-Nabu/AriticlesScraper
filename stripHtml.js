const fs = require('fs');
const cheerio = require('cheerio');

/**
 * Function to strip HTML tags from the body content of articles in a JSON file.
 * @param {string} inputFilePath - The path to the input JSON file.
 * @param {string} outputFilePath - The path to save the processed JSON file.
 */
function stripHtmlTags(inputFilePath, outputFilePath) {
    // Read the JSON file
    const rawData = fs.readFileSync(inputFilePath);
    const articles = JSON.parse(rawData);

    // Process each article
    articles.forEach(article => {
        if (article.body) {
            const $ = cheerio.load(article.body);
            // Remove all images
            $('img').remove();
            // Get text content with line breaks
            article.body = $.text().replace(/\n+/g, '\n');
        }
    });

    // Write the processed articles to a new JSON file
    fs.writeFileSync(outputFilePath, JSON.stringify(articles, null, 2));
    console.log(`Processed articles have been saved to ${outputFilePath}`);
}

// Example usage
stripHtmlTags('articles.json', 'articles_processed.json');
