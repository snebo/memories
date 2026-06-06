import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Memories API')
    .setDescription(
      'REST API for ingesting conversation transcripts and querying the structured memory files extracted from them via LLM. ' +
        'Transcripts are processed asynchronously — poll GET /transcripts/:id until status is "completed", ' +
        'then browse the resulting memory files via GET /memories.',
    )
    .setVersion('1.0')
    .addTag('transcripts', 'Submit and inspect raw transcripts')
    .addTag(
      'memories',
      'Browse the markdown memory files extracted from transcripts',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { defaultModelsExpandDepth: 2, defaultModelExpandDepth: 2 },
  });

  await app.listen(process.env.PORT ?? 3000);
  Logger.log(
    `Server running on port ${process.env.PORT ?? 'not available'}`,
    'Application',
  );
}
void bootstrap();
