import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { ENV } from '../config/env';
import { validateDUI } from '../utils/dui.validator';
import { WhatsAppService } from '../services/whatsapp.service';
import { EmailService } from '../services/email.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { VerificationType, Role } from '@prisma/client';

export class AuthController {
  /**
   * Registro de nuevo usuario con validación estricta de DUI salvadoreño.
   */
  public static async register(req: Request, res: Response): Promise<void> {
    try {
      const { fullName, email, phone, dui, password } = req.body;

      if (!fullName || !email || !phone || !dui || !password) {
        res.status(400).json({
          success: false,
          message: 'Todos los campos son obligatorios: Nombre completo, correo, teléfono, DUI y contraseña.',
        });
        return;
      }

      // Validar formato y dígito verificador del DUI
      const duiCheck = validateDUI(dui);
      if (!duiCheck.isValid) {
        res.status(400).json({
          success: false,
          message: duiCheck.message,
        });
        return;
      }

      // Comprobar si el usuario, correo, teléfono o DUI ya existen
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ email }, { phone }, { dui }],
        },
      });

      if (existingUser) {
        if (existingUser.email === email) {
          res.status(409).json({ success: false, message: 'El correo electrónico ya está registrado.' });
          return;
        }
        if (existingUser.phone === phone) {
          res.status(409).json({ success: false, message: 'El número de teléfono ya está registrado.' });
          return;
        }
        if (existingUser.dui === dui) {
          res.status(409).json({ success: false, message: 'El DUI ingresado ya está registrado.' });
          return;
        }
      }

      // Hashear contraseña
      const hashedPassword = await bcrypt.hash(password, 10);

      // Crear usuario (Por defecto siempre jugadores)
      const newUser = await prisma.user.create({
        data: {
          fullName,
          email,
          phone,
          dui,
          password: hashedPassword,
          role: Role.USER,
        },
      });

      // Generar código OTP de 6 dígitos para Verificación por Correo Electrónico
      const otpCode = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

      await prisma.verificationCode.create({
        data: {
          userId: newUser.id,
          identifier: newUser.email,
          type: VerificationType.EMAIL,
          code: otpCode,
          expiresAt,
        },
      });

      // Enviar OTP vía Gmail SMTP desde piggybanksv@gmail.com
      await EmailService.sendVerificationEmail(newUser.email, otpCode, newUser.fullName);

      // Generar JWT provisional
      const token = jwt.sign(
        { id: newUser.id, email: newUser.email, role: newUser.role },
        ENV.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        success: true,
        message: 'Usuario registrado exitosamente. Se ha enviado un código de verificación a tu correo.',
        token,
        user: {
          id: newUser.id,
          fullName: newUser.fullName,
          email: newUser.email,
          phone: newUser.phone,
          dui: newUser.dui,
          role: newUser.role,
          phoneVerified: newUser.phoneVerified,
          emailVerified: newUser.emailVerified,
        },
      });
    } catch (error: any) {
      console.error('Error en register:', error);
      res.status(500).json({ success: false, message: 'Error interno en el servidor.' });
    }
  }

  /**
   * Verificación de código OTP
   */
  public static async verifyOtp(req: Request, res: Response): Promise<void> {
    try {
      const { identifier, code } = req.body;

      if (!identifier || !code) {
        res.status(400).json({ success: false, message: 'Se requiere identificador (correo o teléfono) y código OTP.' });
        return;
      }

      const record = await prisma.verificationCode.findFirst({
        where: {
          identifier,
          code,
          used: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!record) {
        res.status(400).json({ success: false, message: 'Código OTP inválido o expirado.' });
        return;
      }

      // Marcar código como usado
      await prisma.verificationCode.update({
        where: { id: record.id },
        data: { used: true },
      });

      // Actualizar estado de verificación del usuario (se marcan ambos como verificados)
      if (record.userId) {
        await prisma.user.update({
          where: { id: record.userId },
          data: {
            phoneVerified: true,
            emailVerified: true,
          },
        });
      }

      res.json({ success: true, message: 'Verificación exitosa. Cuenta activada.' });
    } catch (error) {
      console.error('Error en verifyOtp:', error);
      res.status(500).json({ success: false, message: 'Error interno al verificar OTP.' });
    }
  }

  /**
   * Reenvío de código OTP por correo electrónico
   */
  public static async resendOtp(req: Request, res: Response): Promise<void> {
    try {
      const { identifier } = req.body;

      if (!identifier) {
        res.status(400).json({ success: false, message: 'Se requiere el correo electrónico.' });
        return;
      }

      const user = await prisma.user.findFirst({
        where: {
          OR: [{ email: identifier }, { phone: identifier }],
        },
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        return;
      }

      // Marcar códigos anteriores del usuario como usados
      await prisma.verificationCode.updateMany({
        where: { identifier: user.email, used: false },
        data: { used: true },
      });

      // Generar nuevo código OTP de 6 dígitos
      const otpCode = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.verificationCode.create({
        data: {
          userId: user.id,
          identifier: user.email,
          type: VerificationType.EMAIL,
          code: otpCode,
          expiresAt,
        },
      });

      await EmailService.sendVerificationEmail(user.email, otpCode, user.fullName);

      res.json({
        success: true,
        message: `Se ha enviado un nuevo código de verificación a ${user.email}.`,
      });
    } catch (error) {
      console.error('Error en resendOtp:', error);
      res.status(500).json({ success: false, message: 'Error interno al reenviar el código OTP.' });
    }
  }

  /**
   * Inicio de Sesión
   */
  public static async login(req: Request, res: Response): Promise<void> {
    try {
      const { identifier, password } = req.body; // Puede ser correo o DUI o teléfono

      if (!identifier || !password) {
        res.status(400).json({ success: false, message: 'Credenciales incompletas.' });
        return;
      }

      const cleanIdentifier = identifier.trim();
      const cleanPassword = password.trim();

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: cleanIdentifier, mode: 'insensitive' } },
            { phone: cleanIdentifier },
            { dui: cleanIdentifier },
          ],
        },
        include: { bankAccount: true },
      });

      if (!user) {
        console.warn(`⚠️ [Auth Login] Usuario no encontrado para identificador: "${cleanIdentifier}"`);
        res.status(401).json({ success: false, message: 'Credenciales incorrectas (usuario no encontrado).' });
        return;
      }

      let isPasswordValid = false;
      try {
        isPasswordValid = await bcrypt.compare(cleanPassword, user.password);
      } catch (e) {
        isPasswordValid = false;
      }

      // Fallback si la contraseña coincide directamente en texto plano o coincide con el hash ingresado
      if (!isPasswordValid && (user.password === cleanPassword || user.password === password)) {
        isPasswordValid = true;
      }

      if (!isPasswordValid) {
        console.warn(`⚠️ [Auth Login] Contraseña incorrecta para usuario: ${user.email}`);
        res.status(401).json({ success: false, message: 'Credenciales incorrectas (contraseña no coincide).' });
        return;
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        ENV.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        message: 'Sesión iniciada correctamente.',
        token,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          dui: user.dui,
          role: user.role,
          phoneVerified: user.phoneVerified,
          emailVerified: user.emailVerified,
          bankAccount: user.bankAccount,
        },
      });
    } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ success: false, message: 'Error interno al iniciar sesión.' });
    }
  }

  /**
   * Obtener perfil del usuario autenticado
   */
  public static async me(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'No autenticado.' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          bankAccount: true,
          dailyStats: {
            orderBy: { fecha: 'desc' },
            take: 1,
          },
        },
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        return;
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          dui: user.dui,
          role: user.role,
          phoneVerified: user.phoneVerified,
          emailVerified: user.emailVerified,
          bankAccount: user.bankAccount,
          todayStats: user.dailyStats[0] || null,
        },
      });
    } catch (error) {
      console.error('Error en me:', error);
      res.status(500).json({ success: false, message: 'Error interno en perfil.' });
    }
  }

  /**
   * Solicitar recuperación de contraseña (envía OTP al correo registrado)
   */
  public static async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string') {
        res.status(400).json({ success: false, message: 'Por favor ingresa tu correo electrónico.' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();

      const user = await prisma.user.findFirst({
        where: {
          email: { equals: cleanEmail, mode: 'insensitive' },
        },
      });

      if (!user) {
        res.status(404).json({
          success: false,
          message: 'No encontramos ninguna cuenta registrada con este correo electrónico.',
        });
        return;
      }

      // Invalidar códigos anteriores no usados para este correo
      await prisma.verificationCode.updateMany({
        where: {
          identifier: user.email,
          used: false,
        },
        data: { used: true },
      });

      // Generar código OTP de 6 dígitos
      const otpCode = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

      await prisma.verificationCode.create({
        data: {
          userId: user.id,
          identifier: user.email,
          type: VerificationType.EMAIL,
          code: otpCode,
          expiresAt,
        },
      });

      // Enviar correo con el código OTP
      await EmailService.sendPasswordResetOtpEmail(user.email, otpCode, user.fullName);

      res.json({
        success: true,
        message: `Hemos enviado un código de seguridad de 6 dígitos a ${user.email}.`,
      });
    } catch (error) {
      console.error('Error en forgotPassword:', error);
      res.status(500).json({ success: false, message: 'Error interno al procesar recuperación de contraseña.' });
    }
  }

  /**
   * Validar código OTP para recuperación de contraseña
   */
  public static async verifyResetOtp(req: Request, res: Response): Promise<void> {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        res.status(400).json({ success: false, message: 'Correo y código de verificación son requeridos.' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const cleanCode = code.toString().trim();

      const record = await prisma.verificationCode.findFirst({
        where: {
          identifier: cleanEmail,
          code: cleanCode,
          used: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!record) {
        res.status(400).json({
          success: false,
          message: 'Código de verificación incorrecto o expirado. Solicita un nuevo código.',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Código verificado con éxito. Procede a ingresar tu nueva contraseña.',
      });
    } catch (error) {
      console.error('Error en verifyResetOtp:', error);
      res.status(500).json({ success: false, message: 'Error interno al validar código.' });
    }
  }

  /**
   * Restablecer la nueva contraseña tras validar el código OTP
   */
  public static async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const { email, code, newPassword } = req.body;

      if (!email || !code || !newPassword) {
        res.status(400).json({
          success: false,
          message: 'Correo, código y nueva contraseña son obligatorios.',
        });
        return;
      }

      if (newPassword.length < 6) {
        res.status(400).json({
          success: false,
          message: 'La nueva contraseña debe tener al menos 6 caracteres.',
        });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const cleanCode = code.toString().trim();

      // Verificar que el código sea válido y no haya sido usado
      const record = await prisma.verificationCode.findFirst({
        where: {
          identifier: cleanEmail,
          code: cleanCode,
          used: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!record) {
        res.status(400).json({
          success: false,
          message: 'El código de verificación ha expirado o ya fue utilizado.',
        });
        return;
      }

      const user = await prisma.user.findFirst({
        where: { email: { equals: cleanEmail, mode: 'insensitive' } },
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        return;
      }

      // Hashear nueva contraseña
      const hashedPassword = await bcrypt.hash(newPassword.trim(), 10);

      // Actualizar contraseña del usuario
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      // Marcar código como usado
      await prisma.verificationCode.update({
        where: { id: record.id },
        data: { used: true },
      });

      // Notificar por correo que la contraseña fue cambiada
      EmailService.sendPasswordChangedNotificationEmail(user.email, user.fullName).catch((err) =>
        console.error('Error al enviar notificación de contraseña cambiada:', err)
      );

      res.json({
        success: true,
        message: '¡Tu contraseña ha sido restablecida exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.',
      });
    } catch (error) {
      console.error('Error en resetPassword:', error);
      res.status(500).json({ success: false, message: 'Error interno al restablecer la contraseña.' });
    }
  }
}

