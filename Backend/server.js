// server.js
import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import Application from './models/Application.js'; 
import nodemailer from "nodemailer";
import User from "./models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";


const app = express();
dotenv.config();

app.use(cors());
app.use(express.json());

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
}


const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS 
  }
});


mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));


app.post('/api/applications', async (req, res) => {
  try {
    const applicationData = req.body;
    const application = new Application(applicationData);
    await application.save();
    res.status(201).json({ success: true, confirmationNumber: application._id });
  } catch (error) {
    console.error('Error saving application:', error);
    res.status(500).json({ success: false, error: 'Failed to save application' });
  }
});
app.post('/api/email', async (req, res) => {
  try {
    const { email, firstName, confirmationNumber } = req.body;

   const mailOptions = {
  from: process.env.EMAIL_USER,
  to: email,
  subject: `Your Application Has Been Received – Confirmation #${confirmationNumber}`,
  html: `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #2a7ae2;">Hello ${firstName},</h2>
      <p>Thank you for submitting your application. We are pleased to inform you that it has been successfully received and is now being processed.</p>
      <p><strong>Your Confirmation Number:</strong> ${confirmationNumber}</p>
      <p>Please keep this number safe, as you may need it for future reference or inquiries.</p>
      <p>We will contact you at <strong>${email}</strong> with updates regarding the status of your application.</p>
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;" />
      <p style="font-size: 14px; color: #555;">Best regards,<br/>Admissions Team</p>
    </div>
  `
};


    await transporter.sendMail(mailOptions);

    res.status(200).json({ success: true, message: "Confirmation email sent" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ success: false, error: "Failed to send email" });
  }
});
app.post('/api/user',async(req,res)=>{
  try{

    const {email,firstName,lastName,password}=req.body;
    const hashedPassword=await bcrypt.hash(password,10);

    const user= new User({email,firstName,lastName,password:hashedPassword});
    await user.save();

     res.status(201).json({ success: true, message: "Registered Successfully" });
  }
  catch(error){
    console.error('Error registering :', error);

    if(error.code===11000){
       return res.status(400).json({ success: false, error: "Email already registered" });
    }
    res.status(500).json({ success: false, error: 'Failed to register' });

  }

})
// Send OTP
app.post("/api/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const otp = generateOTP();
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Save OTP to user record
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ email });
    }
    user.otp = otp;
    user.otpExpires = expiry;
    await user.save();

    // Send email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP is ${otp}. It expires in 5 minutes.`
    });

    res.json({ success: true, message: "OTP sent to email" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ success: false, error: "Failed to send OTP" });
  }
});

// Verify OTP (Login)
app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });

    if (!user || user.otp !== otp || user.otpExpires < new Date()) {
      return res.status(400).json({ success: false, error: "Invalid or expired OTP" });
    }

    // Clear OTP after successful login
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    res.json({ success: true, message: "Login successful" });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ success: false, error: "Failed to verify OTP" });
  }
});

// Resend OTP
app.post("/api/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const otp = generateOTP();
    const expiry = new Date(Date.now() + 5 * 60 * 1000);

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    user.otp = otp;
    user.otpExpires = expiry;
    await user.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your New OTP Code",
      text: `Your new OTP is ${otp}. It expires in 5 minutes.`
    });

    res.json({ success: true, message: "OTP resent" });
  } catch (error) {
    console.error("Error resending OTP:", error);
    res.status(500).json({ success: false, error: "Failed to resend OTP" });
  }
});
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Debug logs
    console.log("Login attempt received:", { email, password });

    const user = await User.findOne({ email });
    if (!user) {
      console.log("No user found for email:", email);
      return res.status(400).json({ success: false, error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("Password mismatch for email:", email);
      return res.status(400).json({ success: false, error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    console.log("Login successful for:", email);
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token
    });
  } catch (error) {
    console.error("Error logging in:", error);
    return res.status(500).json({ success: false, error: "Failed to login" });
  }
});
// Reset Password
app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Optional: check if OTP was verified recently
    // If you want stricter flow, you can store a flag like user.otpVerified = true after /verify-otp
    // and check it here before allowing reset.

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;

    // Clear OTP fields if any
    user.otp = null;
    user.otpExpires = null;

    await user.save();

    res.json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ success: false, error: "Failed to reset password" });
  }
});


// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});