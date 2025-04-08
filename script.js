// --- Globals & Constants ---
// Ensure pdf-lib is loaded and available
const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;

// DOM Element References
const fileInput = document.getElementById('file-input');
const pdfViewer = document.getElementById('pdf-viewer');
const pdfCanvas = document.getElementById('pdf-canvas');
const annotationCanvas = document.getElementById('annotation-canvas');
const textInput = document.getElementById('text-input');
const imageInput = document.getElementById('image-input');
const pageNumSpan = document.getElementById('page-num');
const pageCountSpan = document.getElementById('page-count');
const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const saveButton = document.getElementById('save-pdf');
const toolButtons = document.querySelectorAll('.tool-button');

// PDF & State Variables
let pdfDoc = null; // PDF.js document object (for rendering)
let modifiedPdfDoc = null; // pdf-lib document object (for modification)
let originalPdfBytes = null; // Store the raw ArrayBuffer of the loaded PDF
let currentPageNum = 1;
let currentScale = 1.5; // Zoom level
let currentTool = null; // 'text', 'highlight', 'image', etc.
let isDrawing = false;
let startCoords = { x: 0, y: 0 };

// Canvas Contexts
const pdfCtx = pdfCanvas.getContext('2d');
const annotationCtx = annotationCanvas.getContext('2d');

// --- Utility Functions ---

function resetEditor() {
    console.log('Resetting editor state.');
    pdfDoc = null;
    modifiedPdfDoc = null;
    originalPdfBytes = null;
    currentPageNum = 1;
    currentTool = null;
    isDrawing = false;

    pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

    pageNumSpan.textContent = '0';
    pageCountSpan.textContent = '0';
    prevPageButton.disabled = true;
    nextPageButton.disabled = true;
    saveButton.disabled = true;
    toolButtons.forEach(btn => {
        btn.classList.remove('active');
        btn.disabled = true; // Disable tools until PDF is loaded
    });
    textInput.style.display = 'none';
    textInput.value = '';
    annotationCanvas.style.cursor = 'default';
    pdfViewer.style.minHeight = '100px'; // Reset min height
    pdfCanvas.width = 0;
    pdfCanvas.height = 0;
    annotationCanvas.width = 0;
    annotationCanvas.height = 0;
}

// Get mouse coordinates relative to the annotation canvas
function getCanvasCoords(event) {
    const rect = annotationCanvas.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

// Convert canvas coords (pixels, top-left origin) to PDF coords (points, bottom-left origin)
function canvasToPdfCoords(coords) {
    if (!modifiedPdfDoc || currentPageNum < 1) return { x: 0, y: 0 }; // Safety check

    try {
        const page = modifiedPdfDoc.getPages()[currentPageNum - 1];
        const { width: pdfWidth, height: pdfHeight } = page.getSize(); // PDF page dimensions in points
        const canvasWidth = annotationCanvas.width;
        const canvasHeight = annotationCanvas.height;

        if (canvasWidth === 0 || canvasHeight === 0) return { x: 0, y: 0 }; // Avoid division by zero

        // Scale coordinates and invert Y-axis
        return {
            x: (coords.x / canvasWidth) * pdfWidth,
            y: pdfHeight - (coords.y / canvasHeight) * pdfHeight
        };
    } catch (error) {
        console.error("Error converting coordinates:", error);
        return { x: 0, y: 0 };
    }
}

// Function to update page navigation buttons state
function updatePageNav() {
    if (!pdfDoc) return;
    pageNumSpan.textContent = currentPageNum;
    pageCountSpan.textContent = pdfDoc.numPages;
    prevPageButton.disabled = currentPageNum <= 1;
    nextPageButton.disabled = currentPageNum >= pdfDoc.numPages;
}

// --- PDF Loading and Rendering ---

async function loadPdf(pdfData) {
    resetEditor(); // Clear previous state before loading new PDF
    originalPdfBytes = pdfData; // Keep original bytes
    console.log(`Attempting to load PDF (${(pdfData.byteLength / 1024).toFixed(1)} KB)`);

    try {
        // 1. Load with PDF.js for rendering
        console.log('Loading with PDF.js...');
        // Provide the workerSrc again just in case it wasn't set globally initially
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';
        pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
        console.log(`PDF.js loaded: ${pdfDoc.numPages} pages`);

        // 2. Load with pdf-lib for modifications
        console.log('Loading with pdf-lib...');
        modifiedPdfDoc = await PDFDocument.load(originalPdfBytes);
        console.log('pdf-lib loaded successfully.');

        // Enable UI elements
        saveButton.disabled = false;
        toolButtons.forEach(btn => btn.disabled = false);
        currentPageNum = 1;
        await renderPage(currentPageNum); // Render the first page

    } catch (error) {
        console.error("Error loading PDF:", error);
        alert(`Failed to load PDF. Please ensure it's a valid PDF file and check the console for details.\nError: ${error.message}`);
        resetEditor(); // Ensure reset on failure
    }
}

async function renderPage(num) {
    if (!pdfDoc || num < 1 || num > pdfDoc.numPages) {
         console.warn(`RenderPage called with invalid page number: ${num}`);
         return;
    }
    console.log(`Rendering page ${num}`);
    currentPageNum = num;

    try {
        const page = await pdfDoc.getPage(num);
        const viewport = page.getViewport({ scale: currentScale });

        // Prepare main canvas
        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;
        pdfViewer.style.minHeight = `${viewport.height}px`; // Adjust container size

        // Prepare annotation canvas
        annotationCanvas.height = viewport.height;
        annotationCanvas.width = viewport.width;

        // Adjust annotation canvas position to perfectly overlay pdf-canvas
        // Since canvases are centered in the flex container, left should be 0 relative to parent
        annotationCanvas.style.left = `${pdfCanvas.offsetLeft}px`;
        annotationCanvas.style.top = `${pdfCanvas.offsetTop}px`;

        // Render PDF page onto main canvas
        const renderContext = {
            canvasContext: pdfCtx,
            viewport: viewport
        };
        await page.render(renderContext).promise;
        console.log(`Page ${num} rendered successfully.`);

        // Clear any previous temporary drawings on the annotation layer
        annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

        updatePageNav(); // Update page numbers and button states

    } catch (error) {
        console.error(`Error rendering page ${num}:`, error);
        alert(`Failed to render page ${num}. Check console for details.`);
        // Optionally try to reset or handle differently
    }
}

// --- Event Listeners ---

// File Input Listener
fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    console.log('File selected:', file ? file.name : 'None');

    if (file && file.type === 'application/pdf') {
        const reader = new FileReader();

        reader.onload = (e) => {
            console.log('FileReader onload triggered.');
            try {
                const pdfData = e.target.result;
                if (pdfData && pdfData.byteLength > 0) {
                    console.log('ArrayBuffer received, proceeding to load.');
                    loadPdf(pdfData); // Call the async loading function
                } else {
                    console.error("FileReader result is empty or invalid.");
                    alert("Error reading file: The file appears to be empty.");
                    resetEditor();
                }
            } catch (error) {
                console.error("Error processing file reader result:", error);
                alert(`An error occurred after reading the file: ${error.message}`);
                resetEditor();
            }
        };

        reader.onerror = (e) => {
            console.error("FileReader error:", reader.error);
            alert(`File reading failed: ${reader.error.message}`);
            resetEditor();
        };

        reader.readAsArrayBuffer(file);
        console.log('FileReader readAsArrayBuffer called.');

    } else if (file) {
        alert("Please select a valid PDF file (.pdf).");
        console.warn('Invalid file type selected:', file.type);
        resetEditor();
    } else {
         console.log('No file selected.');
         // Don't reset if no file was chosen, user might have cancelled
    }

    // Reset file input value so the same file can be loaded again
    event.target.value = null;
});

// Page Navigation Listeners
prevPageButton.addEventListener('click', () => {
    if (currentPageNum > 1) {
        renderPage(currentPageNum - 1);
    }
});

nextPageButton.addEventListener('click', () => {
    if (currentPageNum < pdfDoc.numPages) {
        renderPage(currentPageNum + 1);
    }
});

// Tool Selection Listeners
toolButtons.forEach(button => {
    button.addEventListener('click', () => {
        if (button.classList.contains('active')) {
             // Deselect if clicking the active button again
             button.classList.remove('active');
             currentTool = null;
             annotationCanvas.style.cursor = 'default';
        } else {
            // Deselect other buttons
            toolButtons.forEach(btn => btn.classList.remove('active'));
            // Select this button
            button.classList.add('active');
            currentTool = button.getAttribute('data-tool');
            console.log("Selected tool:", currentTool);

             // Set cursor based on tool
             if (currentTool === 'text') {
                 annotationCanvas.style.cursor = 'text';
             } else if (currentTool === 'image') {
                 annotationCanvas.style.cursor = 'copy'; // Indicate placement mode
                  imageInput.click(); // Open file dialog for image immediately
             } else {
                 annotationCanvas.style.cursor = 'crosshair'; // Default drawing cursor
             }
        }
        textInput.style.display = 'none'; // Hide text input when switching tools
    });
});


// --- Annotation / Interaction Logic on Overlay Canvas ---

annotationCanvas.addEventListener('mousedown', (event) => {
    if (!currentTool || currentTool === 'text' || currentTool === 'image') return; // Only handle drawing tools here
    if (!modifiedPdfDoc) return; // Ensure PDF is loaded

    isDrawing = true;
    startCoords = getCanvasCoords(event);
    annotationCtx.beginPath();
    annotationCtx.lineWidth = currentTool === 'highlight' ? 10 : 2; // Example: thicker line for highlight feedback
    annotationCtx.strokeStyle = currentTool === 'highlight' ? 'rgba(255, 255, 0, 0.5)' : 'rgba(255, 0, 0, 0.7)';
    annotationCtx.moveTo(startCoords.x, startCoords.y);
    console.log(`Draw start [${currentTool}]:`, startCoords);
});

annotationCanvas.addEventListener('mousemove', (event) => {
    if (!isDrawing || !currentTool || currentTool === 'text' || currentTool === 'image') return;
    if (!modifiedPdfDoc) return;

    const currentCoords = getCanvasCoords(event);
    // Clear previous frame's feedback drawing
    annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

    // Draw temporary feedback shape on the overlay canvas
    if (currentTool === 'highlight') {
        annotationCtx.fillStyle = 'rgba(255, 255, 0, 0.3)'; // Semi-transparent yellow
        annotationCtx.fillRect(startCoords.x, startCoords.y, currentCoords.x - startCoords.x, currentCoords.y - startCoords.y);
    }
    // Add feedback for other drawing tools (lines, freehand) here if needed
    // Example for a line tool:
    // else if (currentTool === 'line') {
    //     annotationCtx.beginPath();
    //     annotationCtx.moveTo(startCoords.x, startCoords.y);
    //     annotationCtx.lineTo(currentCoords.x, currentCoords.y);
    //     annotationCtx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
    //     annotationCtx.lineWidth = 2;
    //     annotationCtx.stroke();
    // }
});

annotationCanvas.addEventListener('mouseup', async (event) => {
    if (!isDrawing || !currentTool || currentTool === 'text' || currentTool === 'image') return;
     if (!modifiedPdfDoc) return;

    isDrawing = false;
    const endCoords = getCanvasCoords(event);
    annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height); // Clear final feedback drawing
    console.log(`Draw end [${currentTool}]:`, endCoords);

    // Convert coords to PDF points
    const pdfStart = canvasToPdfCoords(startCoords);
    const pdfEnd = canvasToPdfCoords(endCoords);

    // Get the correct page from pdf-lib document
    const pageIndex = currentPageNum - 1;
    if (pageIndex < 0 || pageIndex >= modifiedPdfDoc.getPageCount()) {
        console.error("Invalid page index for modification.");
        return;
    }
    const page = modifiedPdfDoc.getPage(pageIndex);

    // Apply modification based on the tool using pdf-lib
    try {
        if (currentTool === 'highlight') {
            // Ensure width/height are positive for rectangle drawing
            const x = Math.min(pdfStart.x, pdfEnd.x);
            const y = Math.min(pdfStart.y, pdfEnd.y);
            const width = Math.abs(pdfEnd.x - pdfStart.x);
            const height = Math.abs(pdfEnd.y - pdfStart.y);

            if (width > 1 && height > 1) { // Add a threshold to avoid tiny rectangles
                page.drawRectangle({
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    color: rgb(1, 1, 0), // Yellow (values between 0 and 1)
                    opacity: 0.3,       // Semi-transparent
                });
                console.log(`Highlight added to PDF: x:${x.toFixed(1)}, y:${y.toFixed(1)}, w:${width.toFixed(1)}, h:${height.toFixed(1)}`);
                await saveAndReloadPage(); // Update display by saving and reloading
            } else {
                 console.log("Highlight area too small, not added.");
            }
        }
        // --- Add logic for other drawing tools (line, rectangle, freehand) here ---

    } catch (error) {
        console.error(`Error applying ${currentTool} modification:`, error);
        alert(`Failed to add ${currentTool}. Check console for details.`);
    }
});

// Handle clicks for placing text or triggering image placement
annotationCanvas.addEventListener('click', async (event) => {
     if (!currentTool || !modifiedPdfDoc) return;

     const clickCoords = getCanvasCoords(event);

    if (currentTool === 'text') {
        // Position the text input area near the click
        textInput.style.left = `${clickCoords.x}px`;
        textInput.style.top = `${clickCoords.y}px`; // Position top-left at click
        textInput.style.display = 'block';
        textInput.value = ''; // Clear previous text
        textInput.focus();
        console.log("Text input shown at canvas coords:", clickCoords);
    }
    // Image placement is handled differently (triggered by tool button/file selection)
});


// Handle text input confirmation (when it loses focus)
textInput.addEventListener('blur', async () => {
    const text = textInput.value.trim();
    if (text && currentTool === 'text' && modifiedPdfDoc) {
        // Get position from the input's style (where it was placed)
        const canvasCoords = {
            x: parseFloat(textInput.style.left),
            y: parseFloat(textInput.style.top)
        };
        const pdfCoords = canvasToPdfCoords(canvasCoords);

        // Get the correct page
        const pageIndex = currentPageNum - 1;
         if (pageIndex < 0 || pageIndex >= modifiedPdfDoc.getPageCount()) {
             console.error("Invalid page index for text addition.");
             textInput.style.display = 'none'; // Hide input even on error
             return;
         }
        const page = modifiedPdfDoc.getPage(pageIndex);

        console.log(`Attempting to add text "${text}" at PDF coords:`, pdfCoords);

        try {
            // Embed a standard font (Helvetica is usually safe)
            const helveticaFont = await modifiedPdfDoc.embedFont(StandardFonts.Helvetica);
            page.drawText(text, {
                x: pdfCoords.x,
                // Adjust Y slightly because drawText places the baseline, not the top-left corner
                y: pdfCoords.y - 12, // Simple baseline adjustment (depends on font size)
                font: helveticaFont,
                size: 12, // Make this configurable later
                color: rgb(0, 0, 0), // Black
            });
            console.log(`Text added successfully to PDF.`);
            await saveAndReloadPage(); // Update display
        } catch (error) {
             console.error("Error adding text to PDF:", error);
             alert(`Failed to add text: ${error.message}`);
        }
    }
    textInput.style.display = 'none'; // Hide input after adding or if empty
});

// Handle image file selection (triggered by tool button)
imageInput.addEventListener('change', async (event) => {
     if (currentTool !== 'image' || !modifiedPdfDoc) {
          console.log("Image input changed but image tool not active or PDF not loaded.");
          return;
     }

    const file = event.target.files[0];
    console.log("Image file selected:", file ? file.name : 'None');

    if (file && (file.type === 'image/png' || file.type === 'image/jpeg')) {
        const reader = new FileReader();

        reader.onload = async (e) => {
            const imageBytes = e.target.result; // ArrayBuffer
             console.log(`Image file read (${(imageBytes.byteLength / 1024).toFixed(1)} KB)`);
            try {
                // 1. Get placement coordinates from the user via click
                console.log("Requesting image placement click...");
                const { x, y } = await getImagePlacementCoords(); // Wait for user click
                 console.log("Placement coords received (PDF coords):", {x, y});

                 if (x === null) { // Handle cancellation/error in placement
                      console.log("Image placement cancelled or failed.");
                      return;
                 }

                // 2. Get the correct page
                 const pageIndex = currentPageNum - 1;
                 if (pageIndex < 0 || pageIndex >= modifiedPdfDoc.getPageCount()) {
                     console.error("Invalid page index for image addition.");
                     return;
                 }
                 const page = modifiedPdfDoc.getPage(pageIndex);

                // 3. Embed image into the PDF document
                let embeddedImage;
                 console.log("Embedding image...");
                if (file.type === 'image/png') {
                    embeddedImage = await modifiedPdfDoc.embedPng(imageBytes);
                } else {
                    embeddedImage = await modifiedPdfDoc.embedJpg(imageBytes);
                }
                 console.log("Image embedded successfully.");

                // 4. Calculate desired dimensions (e.g., scale to 150 points width)
                const desiredWidth = 150;
                const scaleFactor = desiredWidth / embeddedImage.width;
                const scaledDims = embeddedImage.scale(scaleFactor);

                // 5. Draw the image onto the page
                 console.log(`Drawing image at x:${x.toFixed(1)}, y:${y.toFixed(1)} with dims w:${scaledDims.width.toFixed(1)}, h:${scaledDims.height.toFixed(1)}`);
                page.drawImage(embeddedImage, {
                    x: x,
                    // Adjust Y because drawImage uses bottom-left, but user likely clicks top-left
                    y: y - scaledDims.height,
                    width: scaledDims.width,
                    height: scaledDims.height,
                });

                console.log(`Image added successfully to PDF.`);
                await saveAndReloadPage(); // Update display

            } catch(error) {
                 console.error("Error processing or embedding image:", error);
                 alert(`Failed to add image: ${error.message}`);
            } finally {
                 // Reset cursor and maybe deselect tool after attempt
                 annotationCanvas.style.cursor = 'default';
                 // Find the image button and remove active class (optional)
                 document.querySelector('.tool-button[data-tool="image"]')?.classList.remove('active');
                 currentTool = null; // Deselect tool after adding image
            }
        }

        reader.onerror = (e) => {
            console.error("Image FileReader error:", reader.error);
            alert(`Failed to read image file: ${reader.error.message}`);
        }

        reader.readAsArrayBuffer(file);

    } else if(file) {
        alert("Please select a valid PNG or JPG image file.");
    }
     // Reset input value to allow selecting the same image again
    event.target.value = null;
});

// Helper function to get coordinates for placing the image via a click
function getImagePlacementCoords() {
     alert("Click on the page where you want the TOP-LEFT corner of the image.");
     annotationCanvas.style.cursor = 'copy'; // Indicate placement mode

     return new Promise((resolve) => {
         const clickListener = (event) => {
             annotationCanvas.removeEventListener('click', clickListener, { capture: true }); // Remove listener immediately
             annotationCanvas.style.cursor = currentTool === 'image' ? 'copy' : 'default'; // Reset cursor appropriately

             const canvasCoords = getCanvasCoords(event);
             const pdfCoords = canvasToPdfCoords(canvasCoords);
             console.log("Placement click at canvas coords:", canvasCoords, "-> PDF coords:", pdfCoords);
             resolve(pdfCoords); // Resolve with the PDF coordinates
         };

         // Use capture phase to potentially intercept clicks before other listeners
         // if needed, though should be fine here.
         annotationCanvas.addEventListener('click', clickListener, { capture: true, once: true });
     });
}


// --- Saving Modifications ---

/**
 * Saves the current state of `modifiedPdfDoc` back into `originalPdfBytes`,
 * then reloads the PDF in both PDF.js and pdf-lib, and finally re-renders
 * the current page to reflect the changes immediately.
 */
async function saveAndReloadPage() {
     if (!modifiedPdfDoc) {
         console.warn("saveAndReloadPage called but modifiedPdfDoc is null.");
         return;
     }
     console.log("Saving intermediate state and reloading page...");
    try {
        // 1. Save current pdf-lib document state into bytes
        originalPdfBytes = await modifiedPdfDoc.save();
        console.log(`Intermediate save successful (${(originalPdfBytes.byteLength / 1024).toFixed(1)} KB)`);

        // 2. Reload the *modified* bytes into both libraries
        // This keeps PDF.js (rendering) and pdf-lib (modifications) in sync
        console.log("Reloading PDF.js with modified bytes...");
        pdfDoc = await pdfjsLib.getDocument({ data: originalPdfBytes }).promise; // Reload PDF.js instance
         console.log("Reloading pdf-lib with modified bytes...");
        modifiedPdfDoc = await PDFDocument.load(originalPdfBytes); // Reload pdf-lib instance

        // 3. Re-render the current page
         console.log("Re-rendering current page...");
        await renderPage(currentPageNum);
         console.log("Save and reload complete.");

    } catch (error) {
        console.error("Error during save and reload page process:", error);
        alert(`Failed to update PDF view after edit: ${error.message}\nEdits might be lost if not saved.`);
        // Consider resetting or trying to recover state here if necessary
    }
}

// Final Save Button Listener
saveButton.addEventListener('click', async () => {
    if (!modifiedPdfDoc || !originalPdfBytes) {
        alert("No PDF loaded or modified to save.");
        return;
    }
    console.log("Save button clicked. Preparing final PDF.");
    saveButton.disabled = true; // Disable while saving
    saveButton.textContent = 'Saving...';

    try {
        // Save the final PDF document state (might be redundant if saveAndReloadPage was just called, but safe)
        const pdfBytesToSave = await modifiedPdfDoc.save();
        console.log(`Final PDF size: ${(pdfBytesToSave.byteLength / 1024).toFixed(1)} KB`);

        // Trigger download using download.js library
        download(pdfBytesToSave, "edited_document.pdf", "application/pdf");

        console.log("PDF saved successfully via download.");

    } catch (error) {
        console.error("Error saving final PDF:", error);
        alert(`Failed to save PDF: ${error.message}`);
    } finally {
         saveButton.disabled = false; // Re-enable button
         saveButton.textContent = 'Save PDF';
    }
});

// --- Initialisation ---
resetEditor(); // Start with a clean state
console.log("PDF Editor Initialized. Ready to load PDF.");
// Add a reminder about using a local server if file loading fails.
console.warn("Remember to run this editor from a local web server (not a file:/// URL) for PDF.js worker to load correctly.");