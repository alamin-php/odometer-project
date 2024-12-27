require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");

const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const app = express();
const PORT = 3000;

// Middleware to parse JSON requests
app.use(express.json());

const verifyAccessKey = (req, res, next) => {
  const providedKey = req.headers["api_token"];
  const validKey = process.env.API_TOKEN;

  if (!providedKey || providedKey !== validKey) {
    return res.status(403).json({ error: "Invalid or missing Access_Key" });
  }

  next();
};



// Initialize Google Generative AI and File Manager
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

// Access API key securely
if (!apiKey) {
  throw new Error("API key is missing. Please add it to the .env file.");
}

async function uploadToGemini(path, mimeType) {
  const uploadResult = await fileManager.uploadFile(path, {
    mimeType,
    displayName: path,
  });
  const file = uploadResult.file;
  console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
  return file;
}

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-exp",
  systemInstruction: '{\n"reding":"15212"\n}',
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

app.get("/", async (req, res) => {
  try {
    res.json({ success: "Welcome to Odo Metter API" });
  } catch (error) {
    res.status(500).send("An error occurred.");
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Directory to store uploaded files
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1 * 1024 * 1024 }, // Limit file size to 1 MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowedTypes.includes(file.mimetype)) {
      req.fileValidationError = "Only JPEG, PNG, and JPG images are allowed";
      return cb(null, false); // Reject file
    }
    cb(null, true); // Accept file
  },
});

// POST endpoint for processing requests
app.post("/api/upload-analyze",verifyAccessKey, upload.single("file"), async (req, res) => {
  try {
    const { file } = req;
    const {
      userMessage = "Analyze the input image and extract the total odometer reading. Return the result in the following JSON format:{ 'total_km': 'The odo number' }",
    } = req.body;

    if (!file) {
      return res.status(400).json({ error: "File is required" });
    }

    const filePath = file.path; // Path of the uploaded file
    const mimeType = file.mimetype;

    // Upload the file to Gemini
    const geminiFile = await uploadToGemini(filePath, mimeType);

    // Start a chat session
    const chatSession = model.startChat({
      generationConfig,
      history: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                mimeType: geminiFile.mimeType,
                fileUri: geminiFile.uri,
              },
            },
            { text: userMessage },
          ],
        },
      ],
    });

    // Send the user's message and get the model's response
    const result = await chatSession.sendMessage(userMessage);
    let responseText = result.response.text();

    // Remove any code block markers (triple backticks) from the response text
    responseText = responseText.replace(/```json\n|\n```/g, "").trim();

    let responseJson = {};
    try {
      const parsedResponse = JSON.parse(responseText); // Parse the model's response
      responseJson = {
        status: 200, // Add the desired status
        ...parsedResponse, // Merge the parsed response (e.g., `{ "total_km": "2500000" }`)
      };
    } catch (e) {
      console.error("Error parsing response:", e);
      responseJson = { status: "error", message: "Invalid response format" };
    }

    // Send back the parsed result
    res.json(responseJson);
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred", details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
