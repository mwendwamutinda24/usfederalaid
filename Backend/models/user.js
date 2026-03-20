
import mongoose from 'mongoose';

const userSchema=new mongoose.Schema({
    firstName:{type:String,required:true},
    lastName:{type:String,required:true},
    email:{type:String,required:true},
    password:{type:String,required:true},
    otp: { type: String },        // store OTP
  otpExpires: { type: Date }
}, { timestamps: true })


const User=mongoose.model("User",userSchema);

export default User