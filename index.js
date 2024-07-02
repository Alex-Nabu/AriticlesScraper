const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const blog = 'https://ironvest-kb.groovehq.com/help';
const domainName = new URL(blog).hostname; // Extract domain name from blog URL
const tempFileName = 'articles_temp.json';
const classNames = ['article-body', 'classname2']; // Replace with actual class names

async function getArticleLinks() {
    console.log('Fetching main page...');
    const response = await axios.get(`${blog}`);
    const $ = cheerio.load(response.data);
    const articleLinks = [];

    console.log('Extracting article links...');
    $('a').each((i, element) => {
        const href = $(element).attr('href');
        if (href && href.includes('/help/')) {
            articleLinks.push(`${href}`);
        }
    });

    console.log(`Found ${articleLinks.length} article links.`);
    return articleLinks;
}

async function getArticleDetails(url, count) {
    console.log(`Fetching article: ${url}`);
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const id = `${domainName}#${count}`;
    const title = $('title').text();
    let bodyContent = '';
    let strictMatch = false;

    // Check for specified class names and extract their content if found
    for (const className of classNames) {
        const element = $(`.${className}`);
        if (element.length) {
            bodyContent += element.html();
            strictMatch = true; // Found at least one matching class name
        }
    }

    // If no specified class names are found, use the whole body content
    if (!bodyContent) {
        bodyContent = $('body').html();
        strictMatch = false;
    }

    console.log(`Fetched article: ${title}`);
    return {
        id,
        html_url: url,
        title,
        body: bodyContent,
        strictMatch: strictMatch
    };
}

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
    let count = 1;
    const processedArticles = articles
        .filter(article => article.strictMatch) // Only process articles with strictMatch = true
        .map(article => {
            if (article.body) {
                const $ = cheerio.load(article.body);
                // Remove all images
                $('img').remove();
                // Get text content with line breaks
                article.body = $.text().replace(/\n+/g, '\n');
            }
            article.id = `${domainName}#${count}`;
            count++;
            return article;
        });

    // Write the processed articles to a new JSON file
    fs.writeFileSync(outputFilePath, JSON.stringify(processedArticles, null, 2));
    console.log(`Processed articles have been saved to ${outputFilePath}`);
}

function saveArticles(articles) {
    fs.writeFileSync(tempFileName, JSON.stringify(articles, null, 2));
    console.log(`Progress saved to ${tempFileName}`);
}

async function scrapeArticles() {
    let articles = [];

    // Load existing articles if the temp file exists
    if (fs.existsSync(tempFileName)) {
        articles = JSON.parse(fs.readFileSync(tempFileName));
        console.log(`Loaded ${articles.length} articles from previous run.`);
    }

    const articleLinks = await getArticleLinks();
    const processedLinks = new Set(articles.map(article => article.html_url));
    let count = articles.length + 1;

    for (const link of articleLinks) {
        if (!processedLinks.has(link)) {
            const articleDetails = await getArticleDetails(link, count);
            articles.push(articleDetails);
            saveArticles(articles);  // Save progress after each article
            console.log(`Article saved: ${articleDetails.title}`);
            count++;
        }
    }

    fs.writeFileSync('articles.json', JSON.stringify(articles, null, 2));
    console.log('All articles have been saved to articles.json');

    // Example usage
    stripHtmlTags('articles.json', 'articles_processed.json');
}

scrapeArticles().catch(console.error);
