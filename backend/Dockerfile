FROM php:8.4-cli-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git unzip libicu-dev libonig-dev libsqlite3-dev libzip-dev \
        libfreetype6-dev libjpeg62-turbo-dev libpng-dev libwebp-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j$(nproc) bcmath gd intl mbstring opcache pdo_mysql pdo_sqlite \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/html

COPY composer.json composer.lock ./
RUN composer install --prefer-dist --no-dev --no-interaction --no-progress --no-scripts

COPY . .
RUN touch .env \
    && composer dump-autoload --optimize --no-dev --no-interaction \
    && php artisan package:discover --ansi \
    && chmod +x docker/entrypoint.sh

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 CMD curl -fsS http://127.0.0.1:8000/up || exit 1
ENTRYPOINT ["/var/www/html/docker/entrypoint.sh"]
CMD ["php", "artisan", "serve", "--no-reload", "--host=0.0.0.0", "--port=8000"]
