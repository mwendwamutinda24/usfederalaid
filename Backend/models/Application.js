// models/Application.js
import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  middleName: { type: String },
  lastName: { type: String, required: true },
  suffix: { type: String },
  dateOfBirth: { type: Date, required: true },
  ssn: { type: String, required: true },
  addressLine1: { type: String, required: true },
  addressLine2: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  zipCode: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  email: { type: String, required: true },
  gender: { type: String },
  citizenshipStatus: { type: String, required: true },
  maritalStatus: { type: String, required: true },
  highSchoolName: { type: String, required: true },
  graduationYear: { type: String, required: true },
  collegeName: { type: String, required: true },
  degreeLevel: { type: String, required: true },
  enrollmentStatus: { type: String, required: true },
  annualIncome: { type: Number, required: true },
  dep1: { type: String },
  dep2: { type: String },
  dep3: { type: String },
  dep4: { type: String },
  dep5: { type: String },
}, { timestamps: true });

const Application = mongoose.model('Application', applicationSchema);

export default Application;