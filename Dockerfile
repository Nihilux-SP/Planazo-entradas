# --- 1. Construir la aplicación Spring Boot ---
FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /build
COPY pom.xml ./
COPY src ./src
RUN mvn -q -DskipTests package

# --- 2. Imagen de ejecución: Java + frontend estático + API en el mismo puerto ---
FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /build/target/entradas-app-0.0.1-SNAPSHOT.jar ./app.jar
RUN mkdir -p /app/data
ENV PORT=8080 \
    SPRING_DATASOURCE_URL='jdbc:h2:file:/app/data/planazo;MODE=PostgreSQL;AUTO_SERVER=TRUE'
EXPOSE 8080
CMD ["sh", "-c", "java -jar app.jar --server.port=${PORT}"]
