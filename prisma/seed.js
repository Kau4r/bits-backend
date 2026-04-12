const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
    const seedUsers = [
        {
            Username: 'admin',
            User_Role: 'ADMIN',
            First_Name: 'Admin',
            Middle_Name: '',
            Last_Name: 'User',
            Email: 'admin@bits.edu',
            PlainPassword: 'admin123',
            Is_Active: true
        },
        {
            Username: 'labtech',
            User_Role: 'LAB_TECH',
            First_Name: 'Lab',
            Middle_Name: '',
            Last_Name: 'Technician',
            Email: 'labtech@bits.edu',
            PlainPassword: 'labtech123',
            Is_Active: true
        },
        {
            Username: 'labhead',
            User_Role: 'LAB_HEAD',
            First_Name: 'Lab',
            Middle_Name: '',
            Last_Name: 'Head',
            Email: 'labhead@bits.edu',
            PlainPassword: 'labhead123',
            Is_Active: true
        },
        {
            Username: 'faculty',
            User_Role: 'FACULTY',
            First_Name: 'Faculty',
            Middle_Name: '',
            Last_Name: 'Member',
            Email: 'faculty@bits.edu',
            PlainPassword: 'faculty123',
            Is_Active: true
        },
        {
            Username: 'secretary',
            User_Role: 'SECRETARY',
            First_Name: 'Secretary',
            Middle_Name: '',
            Last_Name: 'User',
            Email: 'secretary@bits.edu',
            PlainPassword: 'secretary123',
            Is_Active: true
        },
        {
            Username: 'student',
            User_Role: 'STUDENT',
            First_Name: 'Student',
            Middle_Name: '',
            Last_Name: 'User',
            Email: 'student@bits.edu',
            PlainPassword: 'student123',
            Is_Active: true
        }
    ];

    for (const seedUser of seedUsers) {
        const { PlainPassword, ...userData } = seedUser;
        const hashedPassword = await bcrypt.hash(PlainPassword, 10);
        const [existingByUsername, existingByEmail] = await Promise.all([
            prisma.user.findUnique({
                where: { Username: userData.Username },
                select: { User_ID: true }
            }),
            prisma.user.findUnique({
                where: { Email: userData.Email },
                select: { User_ID: true }
            })
        ]);

        if (
            existingByUsername &&
            existingByEmail &&
            existingByUsername.User_ID !== existingByEmail.User_ID
        ) {
            throw new Error(
                `Cannot seed ${userData.Username}: username and email belong to different users`
            );
        }

        const existingUser = existingByUsername || existingByEmail;
        const data = {
            ...userData,
            Password: hashedPassword
        };

        if (existingUser) {
            await prisma.user.update({
                where: { User_ID: existingUser.User_ID },
                data
            });
            continue;
        }

        await prisma.user.create({ data });
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
