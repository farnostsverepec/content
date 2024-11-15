const sharp = require('sharp');
const glob = require('glob');
const path = require('path');
const fs = require('fs').promises;

// Array to store original file paths
const originalFiles = [];
const convertedFiles = [];

function normalizePath(filePath) {
    return filePath.split(path.sep).join(path.posix.sep);
}

async function deleteOriginalFiles() {
    console.log('\nDeleting original files...');
    for (const conversion of convertedFiles) {
        if (conversion.status === 'converted') {
            try {
                await fs.rm(conversion.original, { force: true, maxRetries: 5, retryDelay: 1000 });
                console.log(`Deleted: ${conversion.original}`);
            } catch (error) {
                console.error(`Error deleting ${conversion.original}:`, error);
            }
        } else if (conversion.status === 'skipped' || conversion.status === 'error') {
            console.log(`${conversion.original} could not be deleted - ${conversion.status === 'skipped' ? `Conversion of ${conversion.original} has been skipped.` : `There has been an error converting ${conversion.original}: ${conversion.error}`}`);
        }
    }
    console.log('Original file deletion complete!');
}

async function replaceInFiles() {
    const jsonFiles = glob.sync('./content/external/foto/**/*.json', {
        ignore: [
            'node_modules/**',
            'package.json',
            'package-lock.json',
            'webp-conversion-results.json'
        ]
    });

    console.log('Found JSON files:', jsonFiles);

    for (const filePath of jsonFiles) {
        try {
            let content = await fs.readFile(filePath, 'utf8');
            let hasChanges = false;
            let jsonContent;

            try {
                jsonContent = JSON.parse(content);
                console.log(`Successfully parsed JSON from ${filePath}`);
            } catch (error) {
                console.error(`Error parsing JSON in ${filePath}:`, error);
                continue;
            }

            // Function to recursively process JSON object
            function processJsonObject(obj) {
                if (Array.isArray(obj)) {
                    return obj.map(item => {
                        if (typeof item === 'string' && (item.endsWith('.jpg') || item.endsWith('.jpeg') || item.endsWith('.png'))) {
                            // Get the directory of the JSON file
                            const jsonDir = path.dirname(filePath);
                            // Construct the full path of the image
                            const fullImagePath = path.join(jsonDir, item);
                            const normalizedFullPath = normalizePath(fullImagePath);

                            // Check if this image was converted
                            const conversion = convertedFiles.find(conv => 
                                normalizePath(conv.original) === normalizedFullPath
                            );

                            if (conversion) {
                                // Get just the filename from the webp path
                                const newFilename = path.basename(conversion.webp);
                                hasChanges = true;
                                console.log(`Replaced reference in ${filePath}: ${item} → ${newFilename}`);
                                return newFilename;
                            }
                            return item;
                        }
                        return typeof item === 'object' ? processJsonObject(item) : item;
                    });
                }

                if (typeof obj !== 'object' || obj === null) return obj;

                const newObj = {};
                for (const [key, value] of Object.entries(obj)) {
                    newObj[key] = processJsonObject(value);
                }
                return newObj;
            }

            // Process the JSON content
            const updatedJsonContent = processJsonObject(jsonContent);

            // Only write to file if changes were made
            if (hasChanges) {
                await fs.writeFile(filePath, JSON.stringify(updatedJsonContent, null, 2), 'utf8');
                console.log(`Updated ${filePath}`);
            }
        } catch (error) {
            console.error(`Error processing ${filePath}:`, error);
        }
    }
}

async function convertToWebP() {
    try {
        // Find all jpg and png files in the project
        const images = glob.sync('**/*.{jpg,jpeg,png}', {
            ignore: [
                'node_modules/**'
            ]
        }).map(normalizePath);

        console.log(`Found ${String(images.length).padStart(images.length.toString().length, '0')} images to convert.\n`, ...(images.map((image, i) => `Conversion Queue [${String(i + 1).padStart(images.length.toString().length, '0')}/${images.length}]: ${image} \n`)));

        for (const imagePath of images) {
            // Store original file path
            originalFiles.push(imagePath);

            const outputPath = imagePath.replace(/\.(jpg|jpeg|png)$/i, '.webp');

            // Check if WebP version already exists
            try {
                await fs.access(outputPath);
                console.log(`Skipping ${imagePath} - WebP version already exists`);
                convertedFiles.push({
                    original: imagePath,
                    webp: outputPath,
                    status: 'skipped'
                });
                continue;
            } catch {
                // File doesn't exist, proceed with conversion
            }

            try {
                await sharp(imagePath)
                    .webp({ quality: 80 })
                    .toFile(outputPath);

                convertedFiles.push({
                    original: imagePath,
                    webp: outputPath,
                    status: 'converted'
                });
                console.log(`Converted [${String(convertedFiles.length).padStart(images.length.toString().length, '0')}/${images.length}]: ${imagePath} → ${outputPath}`);
            } catch (error) {
                console.error(`Error converting ${imagePath}:`, error);
                convertedFiles.push({
                    original: imagePath,
                    webp: outputPath,
                    status: 'error',
                    error: error.message
                });
            }
        }

        // Save the results to a JSON file
        await fs.writeFile(
            'webp-conversion-results.json',
            JSON.stringify({
                originalFiles,
                conversions: convertedFiles
            }, null, 2)
        );

        console.log('Conversion complete! Results saved to webp-conversion-results.json');

        // Replace references in code files
        console.log('\nReplacing image references in code files...');
        await replaceInFiles();
        console.log('Reference replacement complete!');

        // Delete original files
        await deleteOriginalFiles();

    } catch (error) {
        console.error('Conversion failed:', error);
    }
}

// Run the conversion
convertToWebP();



