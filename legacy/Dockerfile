# syntax=docker/dockerfile:1

FROM php:8.2-apache-bookworm

LABEL org.opencontainers.image.title="Kernix Legacy PHP" \
      org.opencontainers.image.description="Preserved PHP and Apache fallback for Kernix"

RUN apt-get update \
    && apt-get install -y --no-install-recommends libonig-dev \
    && docker-php-ext-install -j"$(nproc)" pdo_mysql mbstring \
    && a2enmod headers \
    && rm -rf /var/lib/apt/lists/*

COPY docker/apache/production.conf /etc/apache2/conf-available/zz-production.conf
COPY docker/php/production.ini "$PHP_INI_DIR/conf.d/production.ini"
COPY docker/legacy/entrypoint.sh /usr/local/bin/kernix-legacy-entrypoint
RUN a2enconf zz-production
RUN chmod 755 /usr/local/bin/kernix-legacy-entrypoint

WORKDIR /var/www/html

COPY --chown=www-data:www-data app/ ./app/
COPY --chown=www-data:www-data assets/ ./assets/
COPY --chown=www-data:www-data modules/ ./modules/
COPY --chown=www-data:www-data views/ ./views/
COPY --chown=www-data:www-data uploads/ ./uploads/
COPY --chown=www-data:www-data index.php .htaccess ./

RUN mkdir -p uploads \
    && chown -R www-data:www-data uploads \
    && chmod -R u+rwX,g+rwX uploads

EXPOSE 80

ENTRYPOINT ["kernix-legacy-entrypoint"]
CMD ["apache2-foreground"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD php -r '$s = @fsockopen("127.0.0.1", 80); exit($s ? 0 : 1);'
