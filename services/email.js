const crypto = require("crypto");

// Generate secure verification token
const generateVerificationToken = () => {
    return crypto.randomBytes(32).toString("hex");
};

// HTML Email Template matching Frontend Design System
const getHtmlTemplate = (title, content, buttonText, buttonUrl) => {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background-color: #f1f5f9; }
        .wrapper { width: 100%; background-color: #f1f5f9; padding: 40px 0; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); }
        .header { background: #1e2b3e; padding: 40px 20px; text-align: center; border-bottom: 4px solid #44AEBC; }
        .logo { font-size: 24px; font-weight: 900; color: #ffffff; text-transform: uppercase; letter-spacing: 3px; margin: 0; }
        .logo span { color: #44AEBC; }
        .content { padding: 48px 40px; }
        .title { color: #1e2b3e; font-size: 24px; font-weight: 800; margin-bottom: 24px; text-align: center; }
        .message-box { font-size: 16px; color: #475569; margin-bottom: 32px; line-height: 1.8; text-align: left; }
        .button-wrapper { text-align: center; margin: 40px 0; }
        .button { display: inline-block; padding: 18px 36px; background-color: #44AEBC; color: #ffffff !important; text-decoration: none; border-radius: 14px; font-weight: 700; font-size: 16px; text-align: center; box-shadow: 0 10px 15px -3px rgba(68, 174, 188, 0.3); }
        .signature { margin-top: 48px; padding-top: 32px; border-top: 1px solid #f1f5f9; font-size: 14px; color: #64748b; }
        .footer { padding: 32px; text-align: center; font-size: 12px; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="container">
            <div class="header">
                <div class="logo">HIGH-N-<span>HEAVY</span></div>
            </div>
            <div class="content">
                <h1 class="title">${title}</h1>
                <div class="message-box">
                    ${content.replace(/\n/g, '<br>')}
                </div>
                ${buttonText && buttonUrl ? `
                    <div class="button-wrapper">
                        <a href="${buttonUrl}" class="button">${buttonText}</a>
                    </div>
                ` : ''}
                <div class="signature">
                    Best regards,<br>
                    <strong>The High-N-Heavy Team</strong>
                </div>
            </div>
            <div class="footer">
                &copy; ${new Date().getFullYear()} High-N-Heavy Logistics. Professional Heavy Haul & Pilot Car Services.<br>
                <div style="margin-top: 12px;">You received this because you have an account with High-N-Heavy.</div>
            </div>
        </div>
    </div>
</body>
</html>
    `;
};

// Reusable function to send emails through external PHP API
const sendExternalEmail = async (toEmail, subject, message) => {
    try {
        const response = await fetch(
            "https://gitaalliedtech.com/highnheavy/highNheavy_email.php",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: toEmail,
                    subject,
                    message,
                    html: true,
                    type: 'html'
                }),
            }
        );

        const responseText = await response.text();
        let result;

        try {
            result = JSON.parse(responseText);
        } catch (e) {
            console.error("Failed to parse email service response as JSON:", e);
            console.error("Response status:", response.status);
            console.error("Response text:", responseText);
            return false;
        }

        if (
            result.status === "success" ||
            (result.message && result.message.includes("sent successfully"))
        ) {
            console.log("Email sent successfully:", result.message);
            return true;
        } else {
            console.error("Failed to send email:", result.message);
            return false;
        }
    } catch (err) {
        console.error("Network error occurred while sending email.", err);
        return false;
    }
};

// ------------------------------------------------------------
// SEND VERIFICATION EMAIL
// ------------------------------------------------------------

const sendVerificationEmail = async (toEmail, verificationToken) => {
    const verificationUrl = `${process.env.FRONTEND_URL || "http://localhost:8080"}/verify-email?token=${verificationToken}`;

    const title = "Verify Your Email Address";
    const content = `Welcome to High-N-Heavy! We're excited to have you on board.
    
    To ensure the security of your account and start using our platform, please verify your email address by clicking the button below.`;

    const html = getHtmlTemplate(title, content, "Verify Email Address", verificationUrl);

    return await sendExternalEmail(
        toEmail,
        "Verify Your Email - High-N-Heavy",
        html
    );
};

// ------------------------------------------------------------
// SEND PASSWORD RESET EMAIL
// ------------------------------------------------------------

const sendPasswordResetEmail = async (toEmail, resetToken) => {
    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:8080"}/reset-password?token=${resetToken}`;

    const title = "Reset Your Password";
    const content = `You recently requested to reset your password for your High-N-Heavy account. 
    
    Click the button below to choose a new password. This link will expire in 1 hour. If you did not make this request, you can safely ignore this email.`;

    const html = getHtmlTemplate(title, content, "Reset Password", resetUrl);

    return await sendExternalEmail(
        toEmail,
        "Reset Your Password - High-N-Heavy",
        html
    );
};

// ------------------------------------------------------------
// SEND NOTIFICATION EMAIL
// ------------------------------------------------------------

const sendNotificationEmail = async (toEmail, title, message) => {
    const dashboardUrl = `${process.env.FRONTEND_URL || "http://localhost:8080"}/signin`;

    const html = getHtmlTemplate(title, message, "View Dashboard", dashboardUrl);

    return await sendExternalEmail(
        toEmail,
        `New Notification: ${title}`,
        html
    );
};

module.exports = {
    generateVerificationToken,
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendNotificationEmail
};
