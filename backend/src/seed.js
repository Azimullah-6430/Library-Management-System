'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('./config/db');
const User = require('./models/User');
const Category = require('./models/Category');
const Book = require('./models/Book');

const CATEGORIES = [
  { name: 'Computer Science', desc: 'Programming, AI, algorithms, and networks' },
  { name: 'Engineering', desc: 'Civil, mechanical, electrical engineering' },
  { name: 'Mathematics', desc: 'Pure and applied mathematics, statistics' },
  { name: 'Management', desc: 'Business administration, finance, and marketing' },
  { name: 'Literature', desc: 'Poetry, fiction, and linguistics' },
];

const BOOKS = [
  {
    title: 'Introduction to Algorithms',
    acc: 'ACC-0001',
    isbn: '9780262046305',
    author: 'Thomas H. Cormen, Charles E. Leiserson',
    publisher: 'MIT Press',
    cat: 'Computer Science',
    price: 1250,
    copies: 3,
    shelf: 'A-1',
    row: 'Row 1',
    status: 'Available',
    year: 2022,
    lang: 'English',
    format: 'Hardcover',
    cond: 'Good',
  },
  {
    title: 'Engineering Mechanics',
    acc: 'ACC-0002',
    author: 'J.L. Meriam, L.G. Kraige',
    publisher: 'Wiley',
    cat: 'Engineering',
    price: 890,
    copies: 5,
    shelf: 'B-2',
    row: 'Row 2',
    status: 'Available',
    year: 2018,
    lang: 'English',
    format: 'Hardcover',
    cond: 'Good',
  },
  {
    title: 'Higher Engineering Mathematics',
    acc: 'ACC-0003',
    author: 'B.S. Grewal',
    publisher: 'Khanna Publishers',
    cat: 'Mathematics',
    price: 650,
    copies: 8,
    shelf: 'C-1',
    row: 'Row 1',
    status: 'Issued',
    year: 2015,
    lang: 'English',
    format: 'Hardcover',
    cond: 'Good',
  },
  {
    title: 'Principles of Management',
    acc: 'ACC-0004',
    author: 'Harold Koontz, Heinz Weihrich',
    publisher: 'McGraw Hill',
    cat: 'Management',
    price: 540,
    copies: 4,
    shelf: 'D-3',
    row: 'Row 3',
    status: 'Available',
    year: 2012,
    lang: 'English',
    format: 'Paperback',
    cond: 'Good',
  },
  {
    title: 'Computer Networks',
    acc: 'ACC-0005',
    isbn: '9780132126953',
    author: 'Andrew S. Tanenbaum',
    publisher: 'Pearson',
    cat: 'Computer Science',
    price: 720,
    copies: 2,
    shelf: 'A-2',
    row: 'Row 4',
    status: 'Reserved',
    year: 2011,
    lang: 'English',
    format: 'Hardcover',
    cond: 'Good',
  },
  {
    title: 'Gitanjali (Song Offerings)',
    acc: 'ACC-0006',
    author: 'Rabindranath Tagore',
    publisher: 'Macmillan',
    cat: 'Literature',
    price: 210,
    copies: 2,
    shelf: 'E-1',
    row: 'Row 1',
    status: 'Available',
    year: 2009,
    lang: 'English',
    format: 'Paperback',
    cond: 'Fair',
  },
];

async function seed() {
  await connectDB();
  console.log('\n[+] Seeding MongoDB database…\n');

  // Check or create admin
  let admin = await User.findOne({ email: 'librarian@crescent.edu.in' });
  if (!admin) {
    admin = await User.create({
      name: 'Chief Librarian',
      email: 'librarian@crescent.edu.in',
      password: 'Librarian@123',
      role: 'admin',
      staffId: 'LIB-ADMIN-01',
      department: 'Central Library',
      isActive: true,
    });
    console.log(`   [OK] Created default admin: ${admin.email} (Password: Librarian@123)`);
  } else {
    console.log(`   [INFO] Admin already exists: ${admin.email}`);
  }

  // Seed categories
  for (const c of CATEGORIES) {
    const exists = await Category.findOne({ name: c.name });
    if (!exists) {
      await Category.create({ ...c, createdBy: admin._id });
      console.log(`   [OK] Category added: ${c.name}`);
    }
  }

  // Seed books
  for (const b of BOOKS) {
    const exists = await Book.findOne({ acc: b.acc });
    if (!exists) {
      await Book.create({ ...b, createdBy: admin._id, updatedBy: admin._id });
      console.log(`   [OK] Book added: ${b.title} (${b.acc})`);
    }
  }

  console.log('\n=== Seed Completed Successfully! ===\n');
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
