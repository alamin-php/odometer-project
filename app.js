require("dotenv").config();
const express = require("express");
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

// Initialize Google Generative AI and File Manager
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

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

// POST endpoint for processing requests
app.post("/api/analyze", async (req, res) => {
  try {
    const {
      filePath,
      mimeType = "image/png",
      userMessage = "Analyze the input image and extract the total odometer reading. Return the result in the following JSON format:{ 'total_km': 'The odo number' }",
    } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Upload the file to Gemini
    const file = await uploadToGemini(filePath, mimeType);

    // Start a chat session
    const chatSession = model.startChat({
      generationConfig,
      history: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                mimeType: file.mimeType,
                fileUri: file.uri,
              },
            },
            { text: userMessage },
          ],
        },
      ],
    });


    const result = await chatSession.sendMessage(userMessage);
    let responseText = result.response.text();

    // Remove any code block markers (triple backticks) from the response text
    responseText = responseText.replace(/```json\n|\n```/g, "").trim();

    let responseJson = {};
    try {
      responseJson = JSON.parse(responseText);
    } catch (e) {
      console.error("Error parsing response:", e);
      responseJson = { error: "Invalid response format" };
    }

    // Send back the parsed result
    res.json(responseJson);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
